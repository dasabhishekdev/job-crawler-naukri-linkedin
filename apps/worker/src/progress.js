const { Job, CrawlRun } = require("@jobportal/db");

async function updateCrawlProgress(runId, patch) {
  if (!runId) return;
  await CrawlRun.findByIdAndUpdate(runId, { $set: patch });
}

async function incrementCrawlProgress(runId, inc) {
  if (!runId) return;
  await CrawlRun.findByIdAndUpdate(runId, { $inc: inc });
}

async function getFreshJobCount(runId) {
  return Job.countDocuments({
    crawl_run_id: runId,
    freshness: "fresh",
    url_status: "valid_open",
  });
}

async function shouldStopCrawl(runId, config) {
  if (!runId) return false;

  const run = await CrawlRun.findById(runId).select("cancel_requested status").lean();
  if (!run || run.cancel_requested || run.status === "cancelled") {
    return true;
  }

  const target = config?.targetFreshJobs ?? 20;
  const freshCount = await getFreshJobCount(runId);
  return freshCount >= target;
}

async function requestStop(runId, reason = "Stopped by user") {
  if (!runId) return null;
  return CrawlRun.findByIdAndUpdate(
    runId,
    {
      cancel_requested: true,
      status: "cancelled",
      error_message: reason,
      finished_at: new Date(),
    },
    { new: true }
  );
}

async function pushQueryUsed(runId, platform, query) {
  if (!runId || !query) return;
  const field = platform === "naukri" ? "naukri_queries_used" : "linkedin_queries_used";
  await CrawlRun.findByIdAndUpdate(runId, { $push: { [field]: query } });
}

async function getRunProgress(runId) {
  const run = await CrawlRun.findById(runId).lean();
  if (!run) return null;

  const [naukriFetched, linkedinFetched, validOpen, freshCount] = await Promise.all([
    Job.countDocuments({ crawl_run_id: runId, source: "naukri" }),
    Job.countDocuments({ crawl_run_id: runId, source: "linkedin" }),
    Job.countDocuments({ crawl_run_id: runId, url_status: "valid_open" }),
    getFreshJobCount(runId),
  ]);

  const targetFresh =
    run.target_fresh_jobs ?? (Number(process.env.TARGET_FRESH_JOBS) || 20);

  return {
    run_id: runId,
    status: run.status,
    source: run.source,
    live: run.live,
    discovered: run.discovered,
    validated: run.validated,
    valid_open: run.valid_open,
    fresh_found: run.fresh_found ?? freshCount,
    fresh_count: freshCount,
    target_fresh_jobs: targetFresh,
    stale: run.stale,
    dead: run.dead,
    applied: run.applied,
    naukri_fetched: run.naukri_fetched ?? naukriFetched,
    linkedin_fetched: run.linkedin_fetched ?? linkedinFetched,
    naukri_count: naukriFetched,
    linkedin_count: linkedinFetched,
    valid_open_count: validOpen,
    cancel_requested: run.cancel_requested,
    naukri_current_query: run.naukri_current_query,
    linkedin_current_query: run.linkedin_current_query,
    naukri_fresh_from_query: run.naukri_fresh_from_query ?? 0,
    linkedin_fresh_from_query: run.linkedin_fresh_from_query ?? 0,
    fresh_per_keyword_threshold: run.fresh_per_keyword_threshold ?? 5,
    naukri_keyword_source: run.naukri_keyword_source,
    linkedin_keyword_source: run.linkedin_keyword_source,
    naukri_planned_queries: run.naukri_planned_queries || [],
    linkedin_planned_queries: run.linkedin_planned_queries || [],
    error_message: run.error_message,
    started_at: run.started_at,
    finished_at: run.finished_at,
  };
}

module.exports = {
  updateCrawlProgress,
  incrementCrawlProgress,
  pushQueryUsed,
  getFreshJobCount,
  shouldStopCrawl,
  requestStop,
  getRunProgress,
};
