const { JobPosting, JOB_SOURCES } = require("@jobportal/db");
const { syncUserSheet } = require("@jobportal/google");
const { searchWeb, crawlCareerPages } = require("../crawl/discovery");
const { scoreJobs } = require("../crawl/score");
const { normalizeUrl, dedupeKey, isBlocked, matchesLocation, postedAgeDays } = require("../crawl/normalize");
const { withAi, loadResumeAndProfile } = require("./shared");

const MAX_SCORE_PER_RUN = 60;
const RESCORE_WINDOW_DAYS = 7;

/** Normalises one discovered posting, or returns `{ skip: reason }` when it fails the user's filters. */
function toRecord(raw, { profile, maxAgeDays }) {
  const title = String(raw.title || "").trim();
  const company = String(raw.company || "").trim();
  const url = normalizeUrl(raw.apply_url || raw.url);
  if (!title || !company || !url) return { skip: "missing details" };
  if (isBlocked(company, profile.exclude_companies)) return { skip: "excluded company" };
  if (!matchesLocation(raw.location, profile.target_locations, profile.remote_ok)) return { skip: "location" };
  const age = postedAgeDays(raw.posted);
  if (age !== null && age > maxAgeDays) return { skip: "too old" };
  return {
    source: JOB_SOURCES.includes(raw.source) ? raw.source : "web",
    source_site: String(raw.source_site || "").slice(0, 80),
    job_url: url,
    title: title.slice(0, 200),
    company: company.slice(0, 120),
    location: String(raw.location || "").slice(0, 160),
    posted_text: String(raw.posted || "").slice(0, 80),
    age_days: age,
    experience: String(raw.experience || "").slice(0, 80),
    description: String(raw.description || "").slice(0, 6000),
    dedupe_key: dedupeKey(company, title),
  };
}

async function storeNewJobs(records, { userId, runId }) {
  const unique = [];
  const urls = new Set();
  const keys = new Set();
  for (const r of records) {
    if (urls.has(r.job_url) || keys.has(r.dedupe_key)) continue;
    urls.add(r.job_url);
    keys.add(r.dedupe_key);
    unique.push(r);
  }
  const existing = await JobPosting.find(
    { user_id: userId, $or: [{ job_url: { $in: [...urls] } }, { dedupe_key: { $in: [...keys] } }] },
    "job_url dedupe_key"
  ).lean();
  const knownUrls = new Set(existing.map((j) => j.job_url));
  const knownKeys = new Set(existing.map((j) => j.dedupe_key));

  let created = 0;
  for (const r of unique) {
    if (knownUrls.has(r.job_url) || knownKeys.has(r.dedupe_key)) continue;
    try {
      await JobPosting.create({ ...r, user_id: userId, run_id: runId, first_seen_at: new Date() });
      created++;
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  return created;
}

async function crawlTask({ user, run, log, stage, count, checkCancel }) {
  const { resume, profile } = await loadResumeAndProfile(user);
  if (!profile?.target_roles?.length) throw new Error("Add at least one target role to your profile first.");
  const settings = user.crawler;

  return withAi(user, async (ai) => {
    await log.info(`Searching for ${profile.target_roles.length} roles in ${profile.target_locations.join(", ") || "any location"} with ${ai.provider}`);
    await stage("search", "Searching job sites and career pages");
    const searches = [];
    if (settings.web_search) {
      searches.push(searchWeb({ ai, profile, settings, log, rotation: Math.floor(Date.now() / 3600000) }));
    }
    if (settings.career_pages && profile.career_pages?.length) {
      searches.push(crawlCareerPages({ ai, profile, log }));
    }
    const settled = await Promise.allSettled(searches);
    const raw = [];
    for (const outcome of settled) {
      if (outcome.status === "fulfilled") raw.push(...outcome.value);
      else if (outcome.reason?.name === "AiKeyError") throw outcome.reason;
      else await log.warn(outcome.reason?.message || "Search failed");
    }
    profile.markModified("career_pages");
    await profile.save();
    return ingestJobs({ ai, raw, user, profile, resume, run, log, stage, count, checkCancel });
  });
}

/** Filters, de-duplicates, stores and scores discovered postings, then syncs the sheet. Shared by all crawl kinds. */
async function ingestJobs({ ai, raw, user, profile, resume, run, log, stage, count, checkCancel }) {
  const settings = user.crawler;
  const records = [];
  const skipped = {};
  for (const r of raw) {
    const rec = toRecord(r, { profile, maxAgeDays: settings.max_job_age_days });
    if (rec.skip) skipped[rec.skip] = (skipped[rec.skip] || 0) + 1;
    else records.push(rec);
  }
  const created = await storeNewJobs(records, { userId: user._id, runId: run._id });
  await count({ found: raw.length, matched_filters: records.length, new: created });
  const skipText = Object.entries(skipped).map(([reason, n]) => `${n} ${reason}`).join(", ");
  await log.info(
    `Found ${raw.length} postings, ${records.length} passed your filters${skipText ? ` (skipped: ${skipText})` : ""}, ${created} are new`
  );
  await checkCancel();

  await stage("score", "Scoring jobs against your resume");
  const toScore = await JobPosting.find({
    user_id: user._id,
    "match.scored_at": null,
    first_seen_at: { $gte: new Date(Date.now() - RESCORE_WINDOW_DAYS * 86400000) },
  })
    .sort({ first_seen_at: -1 })
    .limit(MAX_SCORE_PER_RUN);
  const scored = await scoreJobs({ ai, jobs: toScore, resumeText: resume.text, profile, log, checkCancel });
  const relevant = await JobPosting.countDocuments({
    run_id: run._id,
    "match.score": { $gte: settings.min_match_to_sheet },
  });
  await count({ scored, relevant });
  await log.info(`Scored ${scored} jobs; ${relevant} new jobs match ${settings.min_match_to_sheet}%+`);

  if (user.google?.refresh_token) {
    await stage("sync", "Updating your Google Sheet");
    try {
      const sync = await syncUserSheet(user);
      await log.info(`Google Sheet updated with ${sync.rows} jobs`);
    } catch (err) {
      await log.warn(`Google Sheet sync failed: ${err.message}`);
    }
  }
  return { found: raw.length, new: created, scored, relevant };
}

module.exports = { crawlTask, ingestJobs, toRecord, storeNewJobs };
