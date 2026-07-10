const express = require("express");
const { CrawlRun } = require("@jobportal/db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 20;
    const runs = await CrawlRun.find().sort("-started_at").limit(limit).lean();
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const run = await CrawlRun.findById(req.params.id).lean();
    if (!run) return res.status(404).json({ error: "Run not found" });
    res.json(run);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
