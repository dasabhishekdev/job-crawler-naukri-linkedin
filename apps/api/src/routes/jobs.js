const express = require("express");
const { Job } = require("@jobportal/db");
const { buildJobFilter } = require("./job-filter");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const { limit = 100, skip = 0, sort = "-match_score" } = req.query;
    const filter = buildJobFilter(req.query);

    const [jobs, total] = await Promise.all([
      Job.find(filter).sort(sort).skip(Number(skip)).limit(Number(limit)).lean(),
      Job.countDocuments(filter),
    ]);

    res.json({ jobs, total, skip: Number(skip), limit: Number(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const job = await Job.findById(req.params.id).lean();
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json(job);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
