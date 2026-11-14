const express = require("express");
const { Job, CrawlRun, CrawlLog, Application } = require("@jobportal/db");
const { startOfTodayIst, nextScheduledRun, getActiveCandidate } = require("@jobportal/agent");

const router = express.Router();

router.get("/dashboard", async (_req, res) => {
  try {
    const candidate = await getActiveCandidate();
    const candidateFilter = candidate?._id ? { candidate_id: candidate._id } : {};
    const since = startOfTodayIst();
    const [
      totalJobs,
      naukriJobs,
      linkedinJobs,
      validOpen,
      applied,
      recentRuns,
      recentLogs,
      appliedToday,
      failedToday,
    ] = await Promise.all([
      Job.countDocuments(candidateFilter),
      Job.countDocuments({ ...candidateFilter, source: "naukri" }),
      Job.countDocuments({ ...candidateFilter, source: "linkedin" }),
      Job.countDocuments({ ...candidateFilter, url_status: "valid_open" }),
      Job.countDocuments({ ...candidateFilter, application_status: "applied" }),
      CrawlRun.find(candidateFilter).sort("-started_at").limit(5).lean(),
      CrawlLog.find().sort("-created_at").limit(20).lean(),
      Application.countDocuments({
        ...candidateFilter,
        status: "applied",
        applied_at: { $gte: since },
      }),
      Application.countDocuments({
        ...candidateFilter,
        status: "failed",
        applied_at: { $gte: since },
      }),
    ]);

    res.json({
      totalJobs,
      naukriJobs,
      linkedinJobs,
      validOpen,
      applied,
      appliedToday,
      failedToday,
      recentRuns,
      recentLogs,
      next_run: nextScheduledRun().toISOString(),
      last_profile_updated_at: candidate?.last_profile_updated_at || null,
      candidate,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
