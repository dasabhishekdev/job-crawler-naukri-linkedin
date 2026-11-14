const express = require("express");
const { CrawlRun, CrawlLog, Job } = require("@jobportal/db");
const {
  getActiveCandidate,
  getCrawlerSettings,
  saveCrawlerSettings,
  nextHourlyRun,
  queueMultiRun,
  hydrateOpenAiEnv,
} = require("@jobportal/agent");
const { googleStatus } = require("@jobportal/google");

const router = express.Router();

const JOB_FIELDS =
  "source source_site job_title company location job_url external_apply_url first_seen_at createdAt scraped_at " +
  "fit_score ai_match_score ats_score ats_missing relevancy summary ai_match_reason tailored posted_text application_status";

function sendError(res, err, status = 500) {
  res.status(status).json({ error: err.message });
}

router.get("/status", async (_req, res) => {
  try {
    await hydrateOpenAiEnv();
    const [candidate, settings, google] = await Promise.all([getActiveCandidate(), getCrawlerSettings(), googleStatus()]);
    const [active, latest] = await Promise.all([
      CrawlRun.findOne({ source: "multi", status: { $in: ["queued", "running"] } }).sort("-started_at").lean(),
      CrawlRun.findOne({ source: "multi" }).sort("-started_at").lean(),
    ]);
    const run = active || latest;
    const logs = run
      ? (await CrawlLog.find({ crawl_run_id: run._id }).sort("-created_at").limit(60).lean()).reverse()
      : [];
    res.json({
      settings,
      next_run_at: settings.hourly_enabled ? nextHourlyRun() : null,
      engines: { cursor: Boolean(process.env.CURSOR_API_KEY), openai: Boolean(process.env.OPENAI_API_KEY) },
      google,
      candidate: candidate && {
        _id: candidate._id,
        name: candidate.name,
        career_pages: candidate.career_pages || [],
        sheet_url: candidate.drive?.sheet_url || "",
        last_synced_at: candidate.drive?.last_synced_at || null,
      },
      run,
      running: Boolean(active),
      logs,
    });
  } catch (err) {
    sendError(res, err);
  }
});

router.put("/settings", async (req, res) => {
  try {
    res.json(await saveCrawlerSettings(req.body || {}));
  } catch (err) {
    sendError(res, err, 400);
  }
});

router.post("/run", async (_req, res) => {
  try {
    const { run, queued } = await queueMultiRun({ triggeredBy: "manual" });
    if (!queued) return res.status(409).json({ error: `A run is already ${run.status}`, run_id: run._id });
    res.status(202).json({ run_id: run._id, queued, message: "All-sources crawl queued" });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/stop", async (_req, res) => {
  try {
    const run = await CrawlRun.findOneAndUpdate(
      { source: "multi", status: { $in: ["queued", "running"] } },
      { cancel_requested: true, status: "cancelled", error_message: "Stopped by user", finished_at: new Date() },
      { new: true }
    );
    if (!run) return res.status(404).json({ error: "No active all-sources run" });
    res.json({ run_id: run._id, status: "cancelled" });
  } catch (err) {
    sendError(res, err);
  }
});

router.put("/career-pages", async (req, res) => {
  try {
    const candidate = await getActiveCandidate();
    if (!candidate) return res.status(404).json({ error: "No active candidate" });
    const pages = (Array.isArray(req.body?.pages) ? req.body.pages : [])
      .map((p) => ({ name: String(p.name || "").trim().slice(0, 80), url: String(p.url || "").trim(), enabled: p.enabled !== false }))
      .filter((p) => /^https?:\/\//i.test(p.url))
      .slice(0, 60);
    const previous = new Map((candidate.career_pages || []).map((p) => [p.url, p]));
    candidate.career_pages = pages.map((p) => {
      const old = previous.get(p.url);
      return old ? { ...old.toObject(), ...p } : p;
    });
    await candidate.save();
    res.json({ career_pages: candidate.career_pages });
  } catch (err) {
    sendError(res, err, 400);
  }
});

router.get("/jobs", async (req, res) => {
  try {
    const candidate = await getActiveCandidate();
    if (!candidate) return res.json({ jobs: [], total: 0 });
    const minFit = Number(req.query.min_fit) || 0;
    const filter = { candidate_id: candidate._id };
    if (req.query.scope === "all") {
      filter.$or = [{ fit_score: { $ne: null } }, { source: { $in: ["web", "career_page"] } }];
    } else {
      filter.source = { $in: ["web", "career_page"] };
    }
    if (minFit) filter.fit_score = { $gte: minFit };
    if (req.query.relevancy) filter.relevancy = req.query.relevancy;
    if (req.query.q) {
      const rx = { $regex: String(req.query.q), $options: "i" };
      filter.$and = [{ $or: [{ job_title: rx }, { company: rx }, { summary: rx }] }];
    }
    const limit = Math.min(500, Number(req.query.limit) || 200);
    const [jobs, total] = await Promise.all([
      Job.find(filter, JOB_FIELDS).sort({ first_seen_at: -1, createdAt: -1 }).limit(limit).lean(),
      Job.countDocuments(filter),
    ]);
    res.json({ jobs, total });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/jobs/:id/tailor", async (req, res) => {
  try {
    const job = await Job.findByIdAndUpdate(
      req.params.id,
      { $set: { "tailored.status": "pending", "tailored.attempts": 0, "tailored.error": null } },
      { new: true }
    );
    if (!job) return res.status(404).json({ error: "Job not found" });
    res.json({ job_id: job._id, message: "Queued for tailoring on the next run" });
  } catch (err) {
    sendError(res, err);
  }
});

module.exports = router;
