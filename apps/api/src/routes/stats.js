const express = require("express");
const { Job, CrawlRun, CrawlLog } = require("@jobportal/db");

const router = express.Router();

router.get("/dashboard", async (_req, res) => {
  try {
    const [
      totalJobs,
      naukriJobs,
      linkedinJobs,
      validOpen,
      applied,
      recentRuns,
      recentLogs,
    ] = await Promise.all([
      Job.countDocuments(),
      Job.countDocuments({ source: "naukri" }),
      Job.countDocuments({ source: "linkedin" }),
      Job.countDocuments({ url_status: "valid_open" }),
      Job.countDocuments({ application_status: "applied" }),
      CrawlRun.find().sort("-started_at").limit(5).lean(),
      CrawlLog.find().sort("-created_at").limit(20).lean(),
    ]);

    res.json({
      totalJobs,
      naukriJobs,
      linkedinJobs,
      validOpen,
      applied,
      recentRuns,
      recentLogs,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
