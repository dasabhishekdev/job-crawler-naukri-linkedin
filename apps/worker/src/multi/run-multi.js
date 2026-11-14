const path = require("path");
const { CrawlRun, Job, ResumeProfile } = require("@jobportal/db");
const { loadBlocklist } = require("@jobportal/core");
const {
  getActiveCandidate,
  candidateToProfile,
  resolveResumeDir,
  getCrawlerSettings,
  hydrateOpenAiEnv,
} = require("@jobportal/agent");
const { syncCandidateSheet, uploadTailoredResume, googleStatus } = require("@jobportal/google");
const { createLogger } = require("../logger");
const { searchWebJobs } = require("./web-search");
const { crawlCareerPages } = require("./career-pages");
const { scoreJob } = require("./score");
const { tailorResume } = require("./tailor");
const { renderResumePdf } = require("./resume-pdf");
const { resumeFileName } = require("./tailor-guard");
const { normalizeUrl, dedupeKey, isBlocked, isBengaluru, postedAgeDays } = require("./normalize");
const { cursorConfigured } = require("./cursor-agent");
const { llmEngine, mapLimit } = require("./llm");

const RECENT_PORTAL_DAYS = 3;

class RunCancelled extends Error {}

async function checkCancel(runId) {
  const run = await CrawlRun.findById(runId, "cancel_requested status").lean();
  if (run?.cancel_requested || run?.status === "cancelled") throw new RunCancelled("Run cancelled");
}

async function setStage(runId, multiStage, tool) {
  await CrawlRun.findByIdAndUpdate(runId, { multi_stage: multiStage, current_tool: tool });
}

function toRecord(raw, { blocklist, maxAgeDays }) {
  const title = String(raw.title || "").trim();
  const company = String(raw.company || "").trim();
  const url = normalizeUrl(raw.apply_url || raw.url);
  if (!title || !company || !url) return null;
  if (isBlocked(company, blocklist) || !isBengaluru(raw.location)) return null;
  const age = postedAgeDays(raw.posted);
  if (age !== null && age > maxAgeDays) return null;
  return {
    source: raw.source,
    job_url: url,
    external_apply_url: url,
    job_title: title.slice(0, 200),
    company: company.slice(0, 120),
    location: String(raw.location || "").slice(0, 160),
    posted_text: String(raw.posted || "").slice(0, 80),
    age_days: age,
    freshness: age === null ? "unknown" : "fresh",
    description: String(raw.description || "").slice(0, 6000),
    experience_level: String(raw.experience || "").slice(0, 80),
    source_site: String(raw.source_site || "").slice(0, 80),
    search_keyword: raw.discovery_query,
    dedupe_key: dedupeKey(company, title),
    url_status: "valid_open",
    apply_type: "external",
  };
}

async function storeNewJobs(records, { candidateId, runId }) {
  const unique = [];
  const urls = new Set();
  const keys = new Set();
  for (const r of records) {
    if (urls.has(r.job_url) || keys.has(r.dedupe_key)) continue;
    urls.add(r.job_url);
    keys.add(r.dedupe_key);
    unique.push(r);
  }

  const existing = await Job.find(
    {
      candidate_id: candidateId,
      $or: [{ job_url: { $in: [...urls] } }, { external_apply_url: { $in: [...urls] } }, { dedupe_key: { $in: [...keys] } }],
    },
    "job_url external_apply_url dedupe_key"
  ).lean();
  const knownUrls = new Set(existing.flatMap((j) => [j.job_url, j.external_apply_url]).filter(Boolean));
  const knownKeys = new Set(existing.map((j) => j.dedupe_key).filter(Boolean));

  const created = [];
  for (const r of unique) {
    if (knownUrls.has(r.job_url) || knownKeys.has(r.dedupe_key)) continue;
    try {
      created.push(
        await Job.create({ ...r, candidate_id: candidateId, crawl_run_id: runId, first_seen_at: new Date(), scraped_at: new Date() })
      );
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  return created;
}

async function loadResumeText(candidate) {
  let doc = candidate.resume_id ? await ResumeProfile.findById(candidate.resume_id).lean() : null;
  if (!doc) doc = await ResumeProfile.findOne({ candidate_id: candidate._id }).sort("-uploaded_at").lean();
  return doc?.text || "";
}

async function discover({ candidate, profile, settings, blocklist, log, runId }) {
  const tasks = [];
  if (settings.sources.web_agent && cursorConfigured()) {
    tasks.push(
      searchWebJobs({
        profile,
        location: settings.location,
        blocklist,
        maxAgeDays: settings.max_job_age_days,
        maxBatches: settings.max_agent_batches,
        perBatch: settings.jobs_per_batch,
        rotation: Math.floor(Date.now() / 3600000),
        log,
      }).then((jobs) => ({ kind: "web", jobs }))
    );
  } else if (settings.sources.web_agent) {
    await log.warn("Web agent skipped: CURSOR_API_KEY is not set");
  }
  if (settings.sources.career_pages) {
    tasks.push(
      crawlCareerPages({ candidate, profile, location: settings.location, log }).then((jobs) => ({ kind: "career", jobs }))
    );
  }

  const raw = [];
  for (const outcome of await Promise.allSettled(tasks)) {
    if (outcome.status === "rejected") {
      await log.warn(`Discovery source failed: ${outcome.reason?.message}`);
      continue;
    }
    const { kind, jobs } = outcome.value;
    await CrawlRun.findByIdAndUpdate(runId, { [kind === "web" ? "web_fetched" : "career_fetched"]: jobs.length });
    raw.push(...jobs);
  }
  const records = raw.map((j) => toRecord(j, { blocklist, maxAgeDays: settings.max_job_age_days })).filter(Boolean);
  const created = await storeNewJobs(records, { candidateId: candidate._id, runId });
  await log.info(`Discovered ${raw.length} postings, ${records.length} passed filters, ${created.length} new`);
  return created;
}

async function scorePending({ candidate, profile, resumeText, settings, log, runId }) {
  const since = new Date(Date.now() - RECENT_PORTAL_DAYS * 86400000);
  const jobs = await Job.find({
    candidate_id: candidate._id,
    scored_at: null,
    $or: [
      { source: { $in: ["web", "career_page"] } },
      { source: { $in: ["naukri", "linkedin"] }, url_status: "valid_open", createdAt: { $gte: since } },
    ],
  })
    .sort({ first_seen_at: -1, createdAt: -1 })
    .limit(settings.max_score_per_run);

  let scored = 0;
  await mapLimit(jobs, 4, async (job) => {
    try {
      Object.assign(job, await scoreJob({ job, resumeText, profile, runId }), { scored_at: new Date() });
      await job.save();
      scored++;
    } catch (err) {
      await log.warn(`Scoring failed for ${job.job_title} @ ${job.company}: ${err.message}`);
    }
  });
  await log.info(`Scored ${scored}/${jobs.length} jobs with ${llmEngine()}`);
  return scored;
}

async function tailorPending({ candidate, settings, log, runId }) {
  if (settings.max_tailor_per_run === 0) return 0;
  const google = await googleStatus();
  if (!google.connected) {
    await log.warn("Tailored resumes skipped: connect Google Drive in Settings");
    return 0;
  }
  const jobs = await Job.find({
    candidate_id: candidate._id,
    $or: [
      { "tailored.status": "pending" },
      {
        fit_score: { $gte: settings.tailor_min_fit },
        ats_score: { $lt: settings.tailor_max_ats },
        $or: [
          { "tailored.status": { $exists: false } },
          { "tailored.status": "none" },
          { "tailored.status": "failed", "tailored.attempts": { $lt: 2 } },
        ],
      },
    ],
  })
    .sort({ fit_score: -1 })
    .limit(settings.max_tailor_per_run);

  const resumeDir = resolveResumeDir(candidate);
  const outDir = path.join(process.env.DATA_DIR || "./data", "tailored", candidate.slug);
  let done = 0;
  for (const job of jobs) {
    await checkCancel(runId);
    await CrawlRun.findByIdAndUpdate(runId, { current_job_title: `${job.job_title} @ ${job.company}` });
    const attempts = (job.tailored?.attempts || 0) + 1;
    try {
      const result = await tailorResume({ candidate, resumeDir, job, runId });
      const fileName = resumeFileName(candidate.name, job.company, job.job_title);
      const filePath = await renderResumePdf(result.resume, path.join(outDir, fileName));
      const uploaded = await uploadTailoredResume(candidate, {
        company: job.company,
        title: job.job_title,
        filePath,
        fileName,
      });
      job.tailored = {
        status: "done",
        attempts,
        base_resume: result.base_resume,
        ats_score: result.ats_score,
        filename: fileName,
        created_at: new Date(),
        ...uploaded,
      };
      await job.save();
      done++;
      await log.info(`Tailored resume for ${job.job_title} @ ${job.company}: ATS ${job.ats_score}% → ${result.ats_score}%`);
    } catch (err) {
      job.tailored = { status: "failed", attempts, error: err.message.slice(0, 500) };
      await job.save();
      await log.warn(`Tailoring failed for ${job.job_title} @ ${job.company}: ${err.message}`);
    }
  }
  return done;
}

async function runMultiSource({ runId = null, triggeredBy = "manual" } = {}) {
  await hydrateOpenAiEnv();
  const candidate = await getActiveCandidate();
  if (!candidate) throw new Error("No active candidate");
  const settings = await getCrawlerSettings();

  const run = runId
    ? await CrawlRun.findByIdAndUpdate(
        runId,
        { status: "running", candidate_id: candidate._id, started_at: new Date() },
        { new: true }
      )
    : await CrawlRun.create({ source: "multi", status: "running", triggered_by: triggeredBy, candidate_id: candidate._id });
  const log = await createLogger(run._id, "multi");

  try {
    const resumeText = await loadResumeText(candidate);
    if (!resumeText) throw new Error(`Upload a resume for ${candidate.name} first`);
    if (!llmEngine()) throw new Error("Set OPENAI_API_KEY or CURSOR_API_KEY to score jobs");

    const profile = candidateToProfile(candidate);
    const blocklist = loadBlocklist();
    await log.info(`All-sources crawl for ${candidate.name} in ${settings.location}`);

    await setStage(run._id, "discover", "web_search");
    const created = await discover({ candidate, profile, settings, blocklist, log, runId: run._id });
    await CrawlRun.findByIdAndUpdate(run._id, { new_jobs: created.length, discovered: created.length });
    await checkCancel(run._id);

    await setStage(run._id, "score", "score_job");
    const scored = await scorePending({ candidate, profile, resumeText, settings, log, runId: run._id });
    const relevant = await Job.countDocuments({
      crawl_run_id: run._id,
      fit_score: { $gte: settings.min_fit_to_sync },
    });
    await CrawlRun.findByIdAndUpdate(run._id, { scored, relevant });
    await checkCancel(run._id);

    await setStage(run._id, "tailor", "tailor_resume");
    const tailored = await tailorPending({ candidate, settings, log, runId: run._id });
    await CrawlRun.findByIdAndUpdate(run._id, { tailored_count: tailored, current_job_title: null });

    await setStage(run._id, "sync", "google_sheet");
    let sheetSynced = false;
    try {
      const sync = await syncCandidateSheet(candidate, { minFit: settings.min_fit_to_sync });
      if (sync) {
        sheetSynced = true;
        await log.info(`Google Sheet updated: ${sync.rows} jobs, newest first`);
      } else {
        await log.warn("Google Sheet skipped: connect Google Drive in Settings");
      }
    } catch (err) {
      await log.error(`Google Sheet sync failed: ${err.message}`);
    }

    await CrawlRun.findByIdAndUpdate(run._id, {
      status: "completed",
      sheet_synced: sheetSynced,
      multi_stage: "done",
      current_tool: null,
      finished_at: new Date(),
    });
    await log.info(`Done: ${created.length} new, ${scored} scored, ${relevant} relevant, ${tailored} tailored resumes`);
    return { run_id: run._id, status: "completed", new_jobs: created.length, scored, relevant, tailored };
  } catch (err) {
    const cancelled = err instanceof RunCancelled;
    await CrawlRun.findByIdAndUpdate(run._id, {
      status: cancelled ? "cancelled" : "failed",
      error_message: cancelled ? null : err.message,
      multi_stage: "done",
      current_tool: null,
      finished_at: new Date(),
    });
    if (cancelled) await log.warn("All-sources crawl cancelled");
    else await log.error(`All-sources crawl failed: ${err.message}`);
    return { run_id: run._id, status: cancelled ? "cancelled" : "failed", error: err.message };
  }
}

module.exports = { runMultiSource, toRecord, storeNewJobs };
