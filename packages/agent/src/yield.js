const { QueryYield, Job } = require("@jobportal/db");

async function recordQueryYield({ candidateId, platform, query, runId }) {
  if (!candidateId || !query) return null;
  const fresh = await Job.countDocuments({
    candidate_id: candidateId,
    crawl_run_id: runId,
    source: platform,
    search_keyword: query,
    freshness: "fresh",
    url_status: "valid_open",
  });
  const discovered = await Job.countDocuments({
    candidate_id: candidateId,
    crawl_run_id: runId,
    source: platform,
    search_keyword: query,
  });
  const applied = await Job.countDocuments({
    candidate_id: candidateId,
    crawl_run_id: runId,
    source: platform,
    search_keyword: query,
    application_status: "applied",
  });

  return QueryYield.findOneAndUpdate(
    { candidate_id: candidateId, platform, query },
    {
      $inc: { discovered, fresh_count: fresh, applied_count: applied },
      $set: { last_used_at: new Date() },
    },
    { upsert: true, new: true }
  );
}

async function getYieldHints(candidateId, platform) {
  if (!candidateId) {
    return { winners: [], duds: [] };
  }
  const rows = await QueryYield.find({ candidate_id: candidateId, platform })
    .sort("-fresh_count")
    .limit(20)
    .lean();
  const winners = rows.filter((r) => r.fresh_count >= 3).slice(0, 6).map((r) => r.query);
  const duds = rows.filter((r) => r.fresh_count === 0 && r.discovered >= 5).slice(0, 6).map((r) => r.query);
  return { winners, duds };
}

module.exports = { recordQueryYield, getYieldHints };
