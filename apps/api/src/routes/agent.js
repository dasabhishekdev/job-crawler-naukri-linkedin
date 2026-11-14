const express = require("express");
const { CrawlRun, Job, Application, AgentEvent, ResumeProfile } = require("@jobportal/db");
const {
  getActiveCandidate,
  nextScheduledRun,
  startOfTodayIst,
  resolveNaukriStoragePath,
  hydrateOpenAiEnv,
  getPublicOpenAiSettings,
} = require("@jobportal/agent");
const fs = require("fs");

const router = express.Router();
const AUTH_BROWSER_URL = process.env.AUTH_BROWSER_URL || "http://localhost:5000";
const TARGET_FRESH_JOBS = Number(process.env.TARGET_FRESH_JOBS) || 20;

async function startLiveCrawl(runId, source) {
  const res = await fetch(`${AUTH_BROWSER_URL}/crawl/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_id: runId, source }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function todayStats(candidateId) {
  const since = startOfTodayIst();
  const match = { createdAt: { $gte: since } };
  const candidateMatch = candidateId ? { candidate_id: candidateId } : {};

  const [applied, failed, skipped, freshJobs, profileRuns, costAgg] = await Promise.all([
    Application.countDocuments({ ...candidateMatch, status: "applied", applied_at: { $gte: since } }),
    Application.countDocuments({ ...candidateMatch, status: "failed", applied_at: { $gte: since } }),
    Application.countDocuments({ ...candidateMatch, status: "skipped", applied_at: { $gte: since } }),
    Job.countDocuments({
      ...candidateMatch,
      freshness: "fresh",
      url_status: "valid_open",
      scraped_at: { $gte: since },
    }),
    CrawlRun.countDocuments({
      ...candidateMatch,
      profile_updated: true,
      started_at: { $gte: since },
    }),
    CrawlRun.aggregate([
      { $match: { ...candidateMatch, started_at: { $gte: since } } },
      {
        $group: {
          _id: null,
          cost: { $sum: "$openai_cost_usd" },
          prompt: { $sum: "$openai_prompt_tokens" },
          completion: { $sum: "$openai_completion_tokens" },
        },
      },
    ]),
  ]);

  const usage = costAgg[0] || { cost: 0, prompt: 0, completion: 0 };
  return {
    applied,
    failed,
    skipped,
    fresh_jobs: freshJobs,
    profile_updates: profileRuns,
    openai_cost_usd: Number(usage.cost || 0),
    openai_prompt_tokens: usage.prompt || 0,
    openai_completion_tokens: usage.completion || 0,
    since,
    match,
  };
}

router.get("/status", async (_req, res) => {
  try {
    const candidate = await getActiveCandidate();
    const running = await CrawlRun.findOne({ status: { $in: ["running", "queued"] }, source: { $ne: "multi" } })
      .sort("-started_at")
      .lean();
    const last = await CrawlRun.findOne({ candidate_id: candidate?._id, source: { $ne: "multi" } }).sort("-started_at").lean();
    const events = running
      ? await AgentEvent.find({ run_id: running._id }).sort("-created_at").limit(40).lean()
      : await AgentEvent.find(candidate?._id ? { candidate_id: candidate._id } : {})
          .sort("-created_at")
          .limit(40)
          .lean();
    const applications = await Application.find(candidate?._id ? { candidate_id: candidate._id } : {})
      .sort("-applied_at")
      .limit(20)
      .populate("job_id")
      .lean();
    const ranked = await Job.find({
      ...(candidate?._id ? { candidate_id: candidate._id } : {}),
      source: "naukri",
      freshness: "fresh",
      url_status: "valid_open",
    })
      .sort("-ai_match_score -match_score")
      .limit(12)
      .lean();

    let agentStatus = "idle";
    if (running?.needs_login || running?.agent_status === "needs_login") agentStatus = "needs_login";
    else if (running?.status === "running" || running?.status === "queued") agentStatus = "running";
    else if (running?.status === "cancelled") agentStatus = "stopped";

    const today = await todayStats(candidate?._id);
    await hydrateOpenAiEnv();
    const openai = await getPublicOpenAiSettings();

    const storage = candidate ? resolveNaukriStoragePath(candidate) : null;
    const candidateJson = candidate?.toObject ? candidate.toObject() : candidate;

    res.json({
      agent_status: agentStatus,
      agent_stage: running?.agent_stage || "idle",
      current_tool: running?.current_tool || null,
      current_job_title: running?.current_job_title || null,
      next_run: nextScheduledRun().toISOString(),
      schedule: "09:00 and 19:00 Asia/Kolkata",
      candidate: candidateJson
        ? {
            ...candidateJson,
            naukri_logged_in: storage ? fs.existsSync(storage) : false,
          }
        : null,
      run: running || last,
      events: events.reverse(),
      today,
      applications,
      ranked_jobs: ranked,
      last_profile_updated_at: candidate?.last_profile_updated_at || null,
      openai: {
        configured: openai.configured,
        verified: openai.verified,
        model: openai.model,
        recommended_model: openai.recommended_model,
        masked_key: openai.masked_key,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/events", async (req, res) => {
  try {
    const limit = Number(req.query.limit) || 80;
    const filter = {};
    if (req.query.run_id) filter.run_id = req.query.run_id;
    const events = await AgentEvent.find(filter).sort("-created_at").limit(limit).lean();
    res.json({ events: events.reverse() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/events/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  let lastId = req.query.since ? new Date(req.query.since) : new Date(Date.now() - 60000);
  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  send("connected", { at: new Date().toISOString() });

  const interval = setInterval(async () => {
    try {
      const events = await AgentEvent.find({ created_at: { $gt: lastId } })
        .sort("created_at")
        .limit(50)
        .lean();
      for (const ev of events) {
        send("event", ev);
        lastId = ev.created_at;
      }
    } catch (err) {
      send("error", { message: err.message });
    }
  }, 1500);

  req.on("close", () => clearInterval(interval));
});

router.post("/run", async (req, res) => {
  try {
    const live = req.body.live !== false;
    const source = req.body.source || "naukri";
    const candidate = await getActiveCandidate();
    if (!candidate) return res.status(400).json({ error: "No active candidate" });

    const resume = candidate.resume_id
      ? await ResumeProfile.findById(candidate.resume_id).lean()
      : await ResumeProfile.findOne({
          $or: [{ candidate_id: candidate._id }, { is_active: true }],
        })
          .sort("-uploaded_at")
          .lean();
    if (!resume) {
      return res.status(400).json({ error: "Upload a resume for this candidate first." });
    }

    const running = await CrawlRun.findOne({ status: { $in: ["running", "queued"] }, source: { $ne: "multi" } });
    if (running) {
      return res.status(409).json({
        error: "An agent or crawl is already running",
        run_id: running._id,
      });
    }

    const run = await CrawlRun.create({
      source,
      status: "queued",
      triggered_by: "agent",
      live,
      agent_loop: true,
      agent_status: "running",
      agent_stage: "session",
      candidate_id: candidate._id,
      resume_id: resume._id,
      target_fresh_jobs: Number(req.body.target_fresh_jobs) || TARGET_FRESH_JOBS,
      keyword_mode: "ai_auto",
    });

    if (live) {
      try {
        const liveResult = await startLiveCrawl(run._id, source);
        return res.json({
          message: `Agent started for ${candidate.name}. Watch Mission Control + browser.`,
          run_id: run._id,
          live: true,
          vnc_url: liveResult.vnc_url,
        });
      } catch (err) {
        await CrawlRun.findByIdAndUpdate(run._id, {
          status: "failed",
          error_message: err.message,
          finished_at: new Date(),
        });
        return res.status(503).json({ error: `Agent failed to start live: ${err.message}`, run_id: run._id });
      }
    }

    res.json({
      message: `Agent queued for ${candidate.name}. Worker will pick it up.`,
      run_id: run._id,
      live: false,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
