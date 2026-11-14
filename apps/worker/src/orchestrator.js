const { chromium } = require("playwright");
const { CrawlRun, Job, Application, ResumeProfile } = require("@jobportal/db");
const {
  getActiveCandidate,
  candidateToProfile,
  resolveResumeDir,
  resolveNaukriStoragePath,
  emitAgentEvent,
  setAgentStage,
  startOfTodayIst,
  rankRunJobs,
  recordQueryYield,
  hydrateOpenAiEnv,
} = require("@jobportal/agent");
const { runPipeline, getConfig } = require("./pipeline");
const { bumpNaukriProfile } = require("./crawlers/naukri-profile");
const { runNaukriApply } = require("./crawlers/naukri-apply");
const { createLogger } = require("./logger");
const { setActiveBrowser } = require("./crawl-control");
const { shouldStopCrawl } = require("./progress");

async function runAgentLoop({
  source = "all",
  triggeredBy = "agent",
  runId = null,
  headless,
  live = false,
} = {}) {
  await hydrateOpenAiEnv();
  const candidate = await getActiveCandidate();
  if (!candidate) throw new Error("No active candidate. Create one in the UI.");

  const config = getConfig();
  if (headless !== undefined) config.headless = headless;

  let run;
  if (runId) {
    run = await CrawlRun.findById(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    run.status = "running";
    run.agent_loop = true;
    run.agent_status = "running";
    run.agent_stage = "session";
    run.candidate_id = candidate._id;
    await run.save();
  } else {
    run = await CrawlRun.create({
      source,
      status: "running",
      triggered_by: triggeredBy,
      live,
      agent_loop: true,
      agent_status: "running",
      agent_stage: "session",
      candidate_id: candidate._id,
      target_fresh_jobs: config.targetFreshJobs,
      keyword_mode: "ai_auto",
    });
  }

  const log = await createLogger(run._id, "agent");
  const profile = candidateToProfile(candidate);
  config.profile = profile;
  config.candidateId = candidate._id;
  config.runId = run._id;
  config.applyPrefs = candidate.apply_prefs || {};
  config.resumeDir = resolveResumeDir(candidate);
  config.storageStatePath = resolveNaukriStoragePath(candidate);

  let resumeDoc = null;
  if (candidate.resume_id) resumeDoc = await ResumeProfile.findById(candidate.resume_id).lean();
  if (!resumeDoc) {
    resumeDoc = await ResumeProfile.findOne({
      $or: [{ candidate_id: candidate._id }, { is_active: true }],
    })
      .sort("-uploaded_at")
      .lean();
  }
  config.resumeText = resumeDoc?.text || "";
  if (resumeDoc && !run.resume_id) {
    run.resume_id = resumeDoc._id;
    await run.save();
  }
  if (!config.resumeText) {
    await CrawlRun.findByIdAndUpdate(run._id, {
      status: "failed",
      error_message: "Upload a resume for this candidate before running the agent.",
      finished_at: new Date(),
      agent_status: "idle",
    });
    throw new Error("Upload a resume for this candidate before running the agent.");
  }

  await emitAgentEvent({
    runId: run._id,
    candidateId: candidate._id,
    stage: "session",
    tool: "start",
    message: `Daily agent started for ${candidate.name}`,
  });

  let browser = null;
  const totals = { applied: 0, apply_failed: 0, apply_skipped: 0, profile_updated: false };

  try {
    const launchOptions = {
      headless: config.headless,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    };
    if (!config.headless) launchOptions.slowMo = 80;
    browser = await chromium.launch(launchOptions);
    setActiveBrowser(browser);

    await setAgentStage(run._id, { agent_stage: "session", current_tool: "check_naukri_session" });
    const sessionPath = resolveNaukriStoragePath(candidate);
    const fs = require("fs");
    if (!fs.existsSync(sessionPath)) {
      await setAgentStage(run._id, { agent_status: "needs_login", needs_login: true });
      await emitAgentEvent({
        runId: run._id,
        candidateId: candidate._id,
        stage: "session",
        tool: "check_naukri_session",
        message: `No Naukri login for ${candidate.name}. Open Browser Login and save the session.`,
        level: "warn",
      });
      await CrawlRun.findByIdAndUpdate(run._id, {
        status: "failed",
        agent_status: "needs_login",
        needs_login: true,
        error_message: "Naukri login required",
        finished_at: new Date(),
      });
      return { run_id: run._id, needs_login: true };
    }

    await setAgentStage(run._id, { agent_stage: "profile", current_tool: "update_naukri_profile" });
    const bump = await bumpNaukriProfile({
      browser,
      candidate,
      resumeText: config.resumeText,
      profile,
      config,
      runId: run._id,
      log,
    });

    if (bump.needsLogin) {
      await CrawlRun.findByIdAndUpdate(run._id, {
        status: "failed",
        agent_status: "needs_login",
        needs_login: true,
        error_message: bump.error,
        finished_at: new Date(),
      });
      return { run_id: run._id, needs_login: true };
    }

    if (bump.ok) {
      totals.profile_updated = true;
      await CrawlRun.findByIdAndUpdate(run._id, { profile_updated: true });
    }

    if (await shouldStopCrawl(run._id, config)) {
      await CrawlRun.findByIdAndUpdate(run._id, {
        status: "cancelled",
        agent_status: "stopped",
        finished_at: new Date(),
      });
      return { run_id: run._id, status: "cancelled" };
    }

    await setAgentStage(run._id, { agent_stage: "discover", current_tool: "crawl_naukri" });
    await emitAgentEvent({
      runId: run._id,
      candidateId: candidate._id,
      stage: "discover",
      tool: "crawl_naukri",
      message: "Discovering jobs with AI search queries",
    });

    await browser.close().catch(() => {});
    browser = null;
    setActiveBrowser(null);

    const crawlResult = await runPipeline({
      source,
      triggeredBy,
      runId: run._id,
      headless: config.headless,
      live,
      skipApply: true,
      candidate,
    });

    if (crawlResult?.status === "cancelled") {
      await setAgentStage(run._id, { agent_status: "stopped", agent_stage: "report" });
      return crawlResult;
    }

    await setAgentStage(run._id, { agent_stage: "rank", current_tool: "score_job" });
    await emitAgentEvent({
      runId: run._id,
      candidateId: candidate._id,
      stage: "rank",
      tool: "score_job",
      message: "Scoring fresh Naukri jobs with AI",
    });

    const runDoc = await CrawlRun.findById(run._id).lean();

    const ranked = await rankRunJobs({
      runId: run._id,
      candidateId: candidate._id,
      resumeText: config.resumeText,
      profile,
    });

    await emitAgentEvent({
      runId: run._id,
      candidateId: candidate._id,
      stage: "rank",
      tool: "score_job",
      message: `Ranked ${ranked.length} jobs`,
    });

    for (const q of runDoc?.naukri_queries_used || []) {
      await recordQueryYield({
        candidateId: candidate._id,
        platform: "naukri",
        query: q,
        runId: run._id,
      });
    }

    const minScore = candidate.ai_min_score ?? 70;
    const since = startOfTodayIst();
    const appliedToday = await Application.countDocuments({
      candidate_id: candidate._id,
      status: "applied",
      applied_at: { $gte: since },
    });
    const remaining = Math.max(0, (candidate.max_apply_per_day || 20) - appliedToday);

    const applyCandidates = ranked
      .filter(
        (job) =>
          job.source === "naukri" &&
          job.apply_type === "naukri" &&
          (job.ai_match_score || 0) >= minScore &&
          ["pending", "failed"].includes(job.application_status)
      )
      .sort((a, b) => (b.ai_match_score || 0) - (a.ai_match_score || 0))
      .slice(0, remaining);

    await setAgentStage(run._id, { agent_stage: "apply", current_tool: "apply_to_job" });
    await emitAgentEvent({
      runId: run._id,
      candidateId: candidate._id,
      stage: "apply",
      tool: "apply_to_job",
      message: remaining
        ? `Applying to ${applyCandidates.length} jobs (daily remaining ${remaining}, min score ${minScore})`
        : "Daily apply cap reached — skipping apply",
    });

    if (applyCandidates.length > 0) {
      browser = await chromium.launch(launchOptions);
      setActiveBrowser(browser);
      const applyLog = await createLogger(run._id, "naukri");
      const applyStats = await runNaukriApply({
        browser,
        jobs: applyCandidates,
        config,
        log: applyLog,
        candidate,
      });
      totals.applied = applyStats.applied;
      totals.apply_failed = applyStats.failed;
      totals.apply_skipped = applyStats.skipped;
    }

    const freshCount = await Job.countDocuments({
      crawl_run_id: run._id,
      freshness: "fresh",
      url_status: "valid_open",
    });

    await CrawlRun.findByIdAndUpdate(run._id, {
      applied: totals.applied,
      apply_failed: totals.apply_failed,
      apply_skipped: totals.apply_skipped,
      fresh_found: freshCount,
      status: "completed",
      agent_status: "idle",
      agent_stage: "report",
      current_tool: null,
      current_job_title: null,
      finished_at: new Date(),
    });

    await emitAgentEvent({
      runId: run._id,
      candidateId: candidate._id,
      stage: "report",
      tool: "write_daily_report",
      message: `Done — ${freshCount} fresh jobs, ${totals.applied} applied, ${totals.apply_failed} failed, profile ${totals.profile_updated ? "updated" : "not updated"}`,
    });

    return { run_id: run._id, status: "completed", fresh_found: freshCount, ...totals };
  } catch (err) {
    await CrawlRun.findByIdAndUpdate(run._id, {
      status: "failed",
      agent_status: "idle",
      error_message: err.message,
      finished_at: new Date(),
    });
    await emitAgentEvent({
      runId: run._id,
      candidateId: candidate._id,
      stage: "report",
      tool: "write_daily_report",
      message: `Agent run failed: ${err.message}`,
      level: "error",
    });
    throw err;
  } finally {
    setActiveBrowser(null);
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { runAgentLoop };
