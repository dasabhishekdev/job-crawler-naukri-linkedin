const express = require("express");
const { CrawlRun, Job, ResumeProfile, KeywordLibrary } = require("@jobportal/db");
const { sanitizeQuery } = require("@jobportal/core");
const { getActiveCandidate } = require("@jobportal/agent");

const router = express.Router();
const AUTH_BROWSER_URL = process.env.AUTH_BROWSER_URL || "http://localhost:5000";
const TARGET_FRESH_JOBS = Number(process.env.TARGET_FRESH_JOBS) || 20;
const MAX_QUERIES = 25;

function normalizeQueryList(list, platform) {
  const seen = new Set();
  const out = [];
  for (const raw of list || []) {
    const q = sanitizeQuery(raw, platform);
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
    if (out.length >= MAX_QUERIES) break;
  }
  return out;
}

async function bumpKeywordUsage(queries, platform) {
  if (!queries.length) return;
  const now = new Date();
  await KeywordLibrary.updateMany(
    {
      active: true,
      platform: { $in: [platform, "both"] },
      text: { $in: queries },
    },
    { $inc: { use_count: 1 }, $set: { last_used_at: now } }
  );
}

function parseKeywordOptions(body, source) {
  const modeRaw = body.keyword_mode;
  const naukriQueries = normalizeQueryList(body.naukri_queries, "naukri");
  const linkedinQueries = normalizeQueryList(body.linkedin_queries, "linkedin");
  const hasSelection = naukriQueries.length > 0 || linkedinQueries.length > 0;

  let keywordMode = "ai_auto";
  if (modeRaw === "selected_only" || modeRaw === "selected_plus_ai" || modeRaw === "ai_auto") {
    keywordMode = modeRaw;
  } else if (hasSelection) {
    keywordMode = "selected_plus_ai";
  }

  if (keywordMode === "selected_only" || keywordMode === "selected_plus_ai") {
    const wantsNaukri = source === "all" || source === "naukri";
    const wantsLinkedIn = source === "all" || source === "linkedin";
    if (wantsNaukri && naukriQueries.length === 0 && source === "naukri") {
      throw new Error("Select at least one Naukri keyword before starting this crawl.");
    }
    if (wantsLinkedIn && linkedinQueries.length === 0 && source === "linkedin") {
      throw new Error("Select at least one LinkedIn keyword before starting this crawl.");
    }
    if (source === "all" && naukriQueries.length === 0 && linkedinQueries.length === 0) {
      throw new Error("Select at least one keyword before starting a selected-keyword crawl.");
    }
  }

  return { keywordMode, naukriQueries, linkedinQueries };
}

async function getProgressForRun(runId) {
  const run = await CrawlRun.findById(runId).lean();
  if (!run) return null;

  const [naukri_count, linkedin_count, valid_open_count, fresh_count] = await Promise.all([
    Job.countDocuments({ crawl_run_id: runId, source: "naukri" }),
    Job.countDocuments({ crawl_run_id: runId, source: "linkedin" }),
    Job.countDocuments({ crawl_run_id: runId, url_status: "valid_open" }),
    Job.countDocuments({
      crawl_run_id: runId,
      freshness: "fresh",
      url_status: "valid_open",
    }),
  ]);

  const targetFresh = run.target_fresh_jobs ?? TARGET_FRESH_JOBS;

  return {
    run_id: runId,
    status: run.status,
    source: run.source,
    live: run.live,
    discovered: run.discovered,
    validated: run.validated,
    valid_open: run.valid_open,
    fresh_found: run.fresh_found ?? fresh_count,
    fresh_count,
    target_fresh_jobs: targetFresh,
    naukri_fetched: run.naukri_fetched ?? naukri_count,
    linkedin_fetched: run.linkedin_fetched ?? linkedin_count,
    naukri_count,
    linkedin_count,
    valid_open_count,
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
    keyword_mode: run.keyword_mode || "ai_auto",
    selected_naukri_queries: run.selected_naukri_queries || [],
    selected_linkedin_queries: run.selected_linkedin_queries || [],
    error_message: run.error_message,
    started_at: run.started_at,
    finished_at: run.finished_at,
  };
}

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

async function stopLiveCrawl(runId) {
  const res = await fetch(`${AUTH_BROWSER_URL}/crawl/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ run_id: runId }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

router.post("/trigger", async (req, res) => {
  try {
    const source = req.body.source || "all";
    const live = req.body.live !== false;

    const activeResume = await ResumeProfile.findOne({ is_active: true }).lean();
    if (!activeResume) {
      return res.status(400).json({
        error: "Upload a resume in Search Settings before crawling.",
      });
    }

    const freshPerKeyword = Math.min(
      10,
      Math.max(5, Number(req.body.fresh_per_keyword_threshold) || 8)
    );
    const targetFreshJobs = Math.min(
      100,
      Math.max(5, Number(req.body.target_fresh_jobs) || TARGET_FRESH_JOBS)
    );

    let keywordMode;
    let naukriQueries;
    let linkedinQueries;
    try {
      ({ keywordMode, naukriQueries, linkedinQueries } = parseKeywordOptions(req.body, source));
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const running = await CrawlRun.findOne({ status: "running", source: { $ne: "multi" } });
    if (running) {
      return res.status(409).json({
        error: `A crawl is already running (${running.source}, started ${running.started_at})`,
        run_id: running._id,
      });
    }

    const queued = await CrawlRun.findOne({ status: "queued", source: { $ne: "multi" } });
    if (queued) {
      return res.status(409).json({
        error: "A crawl is already queued. Wait for it to finish.",
        run_id: queued._id,
      });
    }

    const runFields = {
      source,
      status: "queued",
      triggered_by: "manual",
      target_fresh_jobs: targetFreshJobs,
      resume_id: activeResume._id,
      candidate_id: (await getActiveCandidate())?._id,
      fresh_per_keyword_threshold: freshPerKeyword,
      keyword_mode: keywordMode,
      selected_naukri_queries: naukriQueries,
      selected_linkedin_queries: linkedinQueries,
    };

    const modeLabel =
      keywordMode === "selected_only"
        ? "selected keywords only"
        : keywordMode === "selected_plus_ai"
          ? "selected keywords + AI top-up"
          : "AI query batches";

    if (live) {
      const run = await CrawlRun.create({ ...runFields, live: true });

      try {
        await Promise.all([
          bumpKeywordUsage(naukriQueries, "naukri"),
          bumpKeywordUsage(linkedinQueries, "linkedin"),
        ]);
        const liveResult = await startLiveCrawl(run._id, source);
        return res.json({
          message: `Live crawl started — ${targetFreshJobs} fresh job target (${modeLabel}).`,
          run_id: run._id,
          source,
          live: true,
          target_fresh_jobs: targetFreshJobs,
          fresh_per_keyword_threshold: freshPerKeyword,
          keyword_mode: keywordMode,
          selected_naukri_queries: naukriQueries,
          selected_linkedin_queries: linkedinQueries,
          vnc_url: liveResult.vnc_url,
        });
      } catch (err) {
        await CrawlRun.findByIdAndUpdate(run._id, {
          status: "failed",
          error_message: err.message,
          finished_at: new Date(),
        });
        return res.status(503).json({
          error: `Live crawl failed to start: ${err.message}`,
          run_id: run._id,
        });
      }
    }

    const run = await CrawlRun.create({ ...runFields, live: false });
    await Promise.all([
      bumpKeywordUsage(naukriQueries, "naukri"),
      bumpKeywordUsage(linkedinQueries, "linkedin"),
    ]);

    res.json({
      message: `Background crawl queued (target: ${targetFreshJobs} fresh jobs, ${modeLabel}). Worker will pick it up shortly.`,
      run_id: run._id,
      source,
      live: false,
      target_fresh_jobs: targetFreshJobs,
      fresh_per_keyword_threshold: freshPerKeyword,
      keyword_mode: keywordMode,
      selected_naukri_queries: naukriQueries,
      selected_linkedin_queries: linkedinQueries,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/stop", async (req, res) => {
  try {
    let run;
    if (req.body.run_id) {
      run = await CrawlRun.findById(req.body.run_id);
    } else {
      run = await CrawlRun.findOne({ status: { $in: ["running", "queued"] }, source: { $ne: "multi" } }).sort("-started_at");
    }

    if (!run) {
      return res.status(404).json({ error: "No active crawl found" });
    }

    await CrawlRun.findByIdAndUpdate(run._id, {
      cancel_requested: true,
      status: "cancelled",
      error_message: "Stopped by user",
      finished_at: new Date(),
    });

    if (run.live) {
      try {
        await stopLiveCrawl(run._id);
      } catch (err) {
        console.warn("[crawl/stop] auth-browser:", err.message);
      }
    }

    res.json({
      message: "Crawl stop requested",
      run_id: run._id,
      status: "cancelled",
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/pending", async (_req, res) => {
  try {
    const runs = await CrawlRun.find({ status: { $in: ["queued", "running"] }, source: { $ne: "multi" } })
      .sort("started_at")
      .lean();
    res.json({ runs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/live-status", async (_req, res) => {
  try {
    const res2 = await fetch(`${AUTH_BROWSER_URL}/crawl/status`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = await res2.json().catch(() => ({}));
    if (!res2.ok) throw new Error(data.error || res2.statusText);

    if (data.crawl_run_id) {
      const progress = await getProgressForRun(data.crawl_run_id);
      return res.json({ ...data, progress });
    }

    res.json(data);
  } catch (err) {
    res.json({
      crawl_running: false,
      error: err.message,
    });
  }
});

router.get("/progress/:runId", async (req, res) => {
  try {
    const progress = await getProgressForRun(req.params.runId);
    if (!progress) return res.status(404).json({ error: "Run not found" });
    res.json(progress);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/progress/:runId/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const interval = setInterval(async () => {
    try {
      const progress = await getProgressForRun(req.params.runId);
      if (!progress) {
        send("error", { message: "Run not found" });
        return;
      }
      send("progress", progress);
      if (
        progress.status === "completed" ||
        progress.status === "failed" ||
        progress.status === "cancelled"
      ) {
        clearInterval(interval);
        send("done", progress);
        res.end();
      }
    } catch (err) {
      send("error", { message: err.message });
    }
  }, 2000);

  req.on("close", () => clearInterval(interval));
});

module.exports = router;
