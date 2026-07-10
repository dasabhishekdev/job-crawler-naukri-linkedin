const express = require("express");
const { CrawlLog } = require("@jobportal/db");

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 200;
    const runId = req.query.run_id;
    const filter = runId ? { crawl_run_id: runId } : {};
    const logs = await CrawlLog.find(filter).sort("-created_at").limit(limit).lean();
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let lastId = req.query.since ? new Date(req.query.since) : new Date();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  send("connected", { at: new Date().toISOString() });

  const interval = setInterval(async () => {
    try {
      const logs = await CrawlLog.find({ created_at: { $gt: lastId } })
        .sort("created_at")
        .limit(50)
        .lean();

      for (const log of logs) {
        send("log", log);
        lastId = log.created_at;
      }
    } catch (err) {
      send("error", { message: err.message });
    }
  }, 2000);

  req.on("close", () => clearInterval(interval));
});

module.exports = router;
