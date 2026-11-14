const { chromium } = require("playwright");
const fs = require("fs");
const { loadProfile, getJobKeywords, planQueriesForCrawl } = require("@jobportal/core");
const { CrawlRun, Job, ResumeProfile } = require("@jobportal/db");
const {
  getActiveCandidate,
  candidateToProfile,
  resolveResumeDir,
  resolveNaukriStoragePath,
  getYieldHints,
  hydrateOpenAiEnv,
} = require("@jobportal/agent");
const { createLogger } = require("./logger");
const { runNaukriCrawl } = require("./crawlers/naukri");
const { runNaukriApply } = require("./crawlers/naukri-apply");
const { syncLinkedInJobs } = require("./crawlers/linkedin-sync");
const { runLinkedInLiveCrawl } = require("./crawlers/linkedin-live");
const {
  updateCrawlProgress,
  shouldStopCrawl,
  getFreshJobCount,
} = require("./progress");
const { setActiveBrowser } = require("./crawl-control");

function splitEnvKeywords(envValue, fallback = []) {
  if (!envValue) return [...fallback];
  return envValue
    .split("|")
    .map((k) => k.trim())
    .filter(Boolean);
}

function getConfig(runOverrides = {}) {
  const targetFreshJobs =
    runOverrides.targetFreshJobs ??
    (Number(process.env.TARGET_FRESH_JOBS) || 20);
  return {
    profilePath: process.env.PROFILE_PATH || "./config/profile.json",
    resumeDir: process.env.RESUME_DIR || "../../../anika-resume",
    jobhunterDbPath: process.env.JOBHUNTER_DB_PATH || "../../linkedin-cli/jobs.db",
    storageStatePath: process.env.NAUKRI_STORAGE_STATE || "./data/naukri-storage-state.json",
    location: process.env.NAUKRI_LOCATION || "bengaluru",
    experience: process.env.NAUKRI_EXPERIENCE || "2",
    keywords: splitEnvKeywords(process.env.NAUKRI_KEYWORDS, [
      "operations analyst",
      "purchase executive",
      "logistics analyst",
    ]),
    linkedinKeywords: splitEnvKeywords(process.env.LINKEDIN_KEYWORDS, [
      "operations analyst logistics",
      "supply chain analyst bangalore",
      "procurement analyst",
    ]),
    targetFreshJobs,
    targetJobs: targetFreshJobs,
    maxJobAgeDays: Number(process.env.MAX_JOB_AGE_DAYS) || 14,
    tier1MinScore: Number(process.env.TIER1_MIN_SCORE) || 5,
    tier2MinScore: Number(process.env.TIER2_MIN_SCORE) || 1,
    maxAutoApply: Number(process.env.MAX_AUTO_APPLY_PER_RUN) || 10,
    autoApplyEnabled: process.env.AUTO_APPLY_ENABLED === "true",
    headless: process.env.HEADLESS !== "false",
    searchDelayMs: Number(process.env.SEARCH_DELAY_MS) || 2000,
    validateDelayMs: Number(process.env.VALIDATE_DELAY_MS) || 1500,
    applyDelayMs: Number(process.env.APPLY_DELAY_MS) || 3000,
  };
}

async function assertNoConcurrentRun(excludeRunId = null) {
  const query = { status: "running", source: { $ne: "multi" } };
  if (excludeRunId) query._id = { $ne: excludeRunId };
  const existing = await CrawlRun.findOne(query);
  if (existing) {
    throw new Error(`Another crawl is already running (${existing._id})`);
  }
}

async function runPipeline({
  source = "all",
  triggeredBy = "manual",
  runId = null,
  headless,
  live = false,
  skipApply = false,
  candidate: candidateArg = null,
} = {}) {
  await hydrateOpenAiEnv();
  const config = getConfig();
  if (headless !== undefined) config.headless = headless;

  const candidate = candidateArg || (await getActiveCandidate());
  let profile;
  try {
    profile = loadProfile(config.profilePath);
  } catch {
    profile = { target_roles: [], skills: [], locations: [], job_keywords: [] };
  }
  if (candidate) {
    profile = { ...profile, ...candidateToProfile(candidate) };
    config.resumeDir = resolveResumeDir(candidate);
    config.storageStatePath = resolveNaukriStoragePath(candidate);
    config.candidateId = candidate._id;
    config.profile = profile;
    config.applyPrefs = candidate.apply_prefs || {};
    if (profile.job_keywords?.length) {
      config.keywords = [...new Set([...config.keywords, ...profile.job_keywords])];
    }
  }

  await assertNoConcurrentRun(runId);

  let run;
  if (runId) {
    run = await CrawlRun.findById(runId);
    if (!run) throw new Error(`Run not found: ${runId}`);
    if (run.cancel_requested || run.status === "cancelled") {
      return { run_id: run._id, stopped: true, status: "cancelled" };
    }
    run.status = "running";
    run.cancel_requested = false;
    if (live) run.live = true;
    if (candidate) run.candidate_id = candidate._id;
    config.targetFreshJobs = run.target_fresh_jobs ?? config.targetFreshJobs;
    config.freshPerKeyword = run.fresh_per_keyword_threshold ?? 8;
    await run.save();
  } else {
    run = await CrawlRun.create({
      source,
      status: "running",
      triggered_by: triggeredBy,
      live,
      candidate_id: candidate?._id,
      target_fresh_jobs: config.targetFreshJobs,
      fresh_per_keyword_threshold: 8,
    });
    config.freshPerKeyword = run.fresh_per_keyword_threshold ?? 8;
  }

  const log = await createLogger(run._id, source);

  let resumeText = null;
  if (run.resume_id) {
    const resumeDoc = await ResumeProfile.findById(run.resume_id).lean();
    resumeText = resumeDoc?.text;
  }
  if (!resumeText && candidate?.resume_id) {
    const resumeDoc = await ResumeProfile.findById(candidate.resume_id).lean();
    resumeText = resumeDoc?.text;
  }
  if (!resumeText) {
    const active = await ResumeProfile.findOne({
      $or: candidate?._id
        ? [{ candidate_id: candidate._id }, { is_active: true }]
        : [{ is_active: true }],
    })
      .sort("-uploaded_at")
      .lean();
    resumeText = active?.text;
    if (active && !run.resume_id) {
      run.resume_id = active._id;
      await run.save();
    }
  }
  if (!resumeText) {
    throw new Error("No resume uploaded. Upload a resume in Search Settings before crawling.");
  }

  config.resumeText = resumeText;
  config.runId = run._id;
  if (!config.freshPerKeyword) {
    config.freshPerKeyword = run.fresh_per_keyword_threshold ?? 8;
  }

  const keywordMode = run.keyword_mode || "ai_auto";
  const selectedNaukri = Array.isArray(run.selected_naukri_queries)
    ? run.selected_naukri_queries.filter(Boolean)
    : [];
  const selectedLinkedin = Array.isArray(run.selected_linkedin_queries)
    ? run.selected_linkedin_queries.filter(Boolean)
    : [];
  config.keywordMode = keywordMode;
  config.allowKeywordTopUp = keywordMode !== "selected_only";
  config.keywordSourceLabel =
    keywordMode === "selected_only" || keywordMode === "selected_plus_ai"
      ? "selected"
      : "ai";

  config.fallbackKeywordsByPlatform = {
    naukri: [...new Set([...config.keywords])],
    linkedin: [...new Set([...config.linkedinKeywords, ...getJobKeywords(profile)])],
  };

  config.queryQueueByPlatform = { naukri: [], linkedin: [] };

  const naukriYield = candidate ? await getYieldHints(candidate._id, "naukri") : { winners: [], duds: [] };
  const linkedinYield = candidate ? await getYieldHints(candidate._id, "linkedin") : { winners: [], duds: [] };

  await log.info(
    `Crawl run started (source=${source}, trigger=${triggeredBy}, mode=${keywordMode}, target=${config.targetFreshJobs} fresh jobs, ${config.freshPerKeyword} fresh/query)`
  );

  const wantsNaukri = source === "all" || source === "naukri";
  const wantsLinkedIn = source === "all" || source === "linkedin";
  const linkedinState =
    process.env.LINKEDIN_STORAGE_STATE || "/app/linkedin-cli/storageState.json";
  const useLinkedInLive =
    wantsLinkedIn && (live || !config.headless) && fs.existsSync(linkedinState);
  const linkedinLocation =
    process.env.LINKEDIN_LOCATION || "Bangalore, Karnataka, India";

  if (wantsNaukri) {
    if (keywordMode === "selected_only" || keywordMode === "selected_plus_ai") {
      let queries = [...selectedNaukri];
      let sourceLabel = "selected";
      if (keywordMode === "selected_plus_ai" && queries.length === 0) {
        const planned = await planQueriesForCrawl({
          resumeText: config.resumeText,
          platform: "naukri",
          location: config.location,
          targetFreshJobs: config.targetFreshJobs,
          freshPerKeyword: config.freshPerKeyword,
          fallbackKeywords: config.fallbackKeywordsByPlatform.naukri,
          log,
          yieldHints: naukriYield,
        });
        queries = [...planned.queries];
        sourceLabel = planned.source;
      } else if (keywordMode === "selected_plus_ai" && queries.length > 0) {
        // Selected first; AI top-up happens later via planner when queue empties
        sourceLabel = "selected";
      }
      if (queries.length === 0 && keywordMode === "selected_only") {
        await log.warn("No Naukri keywords selected — skipping Naukri crawl");
      } else {
        config.queryQueueByPlatform.naukri = [...queries];
        await updateCrawlProgress(run._id, {
          naukri_planned_queries: queries,
          naukri_current_query: queries[0] || null,
          naukri_fresh_from_query: 0,
          naukri_keyword_source: sourceLabel,
        });
        await log.info(
          `Naukri query batch (${sourceLabel}, ${queries.length} queries): ${queries.join(" | ")}`
        );
      }
    } else {
      const planned = await planQueriesForCrawl({
        resumeText: config.resumeText,
        platform: "naukri",
        location: config.location,
        targetFreshJobs: config.targetFreshJobs,
        freshPerKeyword: config.freshPerKeyword,
        fallbackKeywords: config.fallbackKeywordsByPlatform.naukri,
        log,
        yieldHints: naukriYield,
      });
      config.queryQueueByPlatform.naukri = [...planned.queries];
      await updateCrawlProgress(run._id, {
        naukri_planned_queries: planned.queries,
        naukri_current_query: planned.queries[0] || null,
        naukri_fresh_from_query: 0,
        naukri_keyword_source: planned.source,
      });
      await log.info(
        `Naukri query batch (${planned.source}, ${planned.queries.length} queries): ${planned.queries.join(" | ")}`
      );
    }
  }

  if (wantsLinkedIn && useLinkedInLive) {
    if (keywordMode === "selected_only" || keywordMode === "selected_plus_ai") {
      let queries = [...selectedLinkedin];
      let sourceLabel = "selected";
      if (keywordMode === "selected_plus_ai" && queries.length === 0) {
        const planned = await planQueriesForCrawl({
          resumeText: config.resumeText,
          platform: "linkedin",
          location: linkedinLocation,
          targetFreshJobs: config.targetFreshJobs,
          freshPerKeyword: config.freshPerKeyword,
          fallbackKeywords: config.fallbackKeywordsByPlatform.linkedin,
          log,
          yieldHints: linkedinYield,
        });
        queries = [...planned.queries];
        sourceLabel = planned.source;
      }
      if (queries.length === 0 && keywordMode === "selected_only") {
        await log.warn("No LinkedIn keywords selected — skipping LinkedIn crawl");
      } else {
        config.queryQueueByPlatform.linkedin = [...queries];
        await updateCrawlProgress(run._id, {
          linkedin_planned_queries: queries,
          linkedin_current_query: queries[0] || null,
          linkedin_fresh_from_query: 0,
          linkedin_keyword_source: sourceLabel,
        });
        await log.info(
          `LinkedIn query batch (${sourceLabel}, ${queries.length} queries): ${queries.join(" | ")}`
        );
      }
    } else {
      const planned = await planQueriesForCrawl({
        resumeText: config.resumeText,
        platform: "linkedin",
        location: linkedinLocation,
        targetFreshJobs: config.targetFreshJobs,
        freshPerKeyword: config.freshPerKeyword,
        fallbackKeywords: config.fallbackKeywordsByPlatform.linkedin,
        log,
        yieldHints: linkedinYield,
      });
      config.queryQueueByPlatform.linkedin = [...planned.queries];
      await updateCrawlProgress(run._id, {
        linkedin_planned_queries: planned.queries,
        linkedin_current_query: planned.queries[0] || null,
        linkedin_fresh_from_query: 0,
        linkedin_keyword_source: planned.source,
      });
      await log.info(
        `LinkedIn query batch (${planned.source}, ${planned.queries.length} queries): ${planned.queries.join(" | ")}`
      );
    }
  }

  const totals = {
    discovered: 0,
    validated: 0,
    valid_open: 0,
    stale: 0,
    dead: 0,
    applied: 0,
    apply_failed: 0,
  };

  let browser = null;

  try {
    if (wantsNaukri || useLinkedInLive) {
      const launchOptions = {
        headless: config.headless,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      };
      if (!config.headless) launchOptions.slowMo = 80;
      browser = await chromium.launch(launchOptions);
      setActiveBrowser(browser);
    }

    if (await shouldStopCrawl(run._id, config)) {
      const runDoc = await CrawlRun.findById(run._id).lean();
      const status = runDoc?.cancel_requested ? "cancelled" : "completed";
      await log.info(status === "cancelled" ? "Crawl cancelled before start" : "Target already met");
      await CrawlRun.findByIdAndUpdate(run._id, {
        status,
        finished_at: new Date(),
        error_message: runDoc?.cancel_requested ? "Stopped by user" : undefined,
      });
      return { run_id: run._id, stopped: true, status };
    }

    const tasks = [];

    if (wantsLinkedIn) {
      tasks.push(
        (async () => {
          const linkedinLog = await createLogger(run._id, "linkedin");
          if (useLinkedInLive && browser) {
            return runLinkedInLiveCrawl({
              browser,
              profile,
              config,
              runId: run._id,
              log: linkedinLog,
            });
          }
          return syncLinkedInJobs({
            dbPath: config.jobhunterDbPath,
            profile,
            config,
            runId: run._id,
            log: linkedinLog,
          });
        })()
      );
    }

    if (wantsNaukri && browser) {
      tasks.push(
        (async () => {
          const naukriLog = await createLogger(run._id, "naukri");
          return runNaukriCrawl({
            browser,
            profile,
            config,
            runId: run._id,
            log: naukriLog,
          });
        })()
      );
    }

    if (tasks.length > 1) {
      await log.info("Running Naukri + LinkedIn crawls in parallel (watch noVNC)");
    }

    const results = await Promise.all(tasks);

    let linkedinStats = null;
    let naukriStats = null;
    let resultIndex = 0;

    if (wantsLinkedIn) {
      linkedinStats = results[resultIndex++];
      const synced = linkedinStats.synced ?? linkedinStats.valid_open ?? 0;
      await log.info(`LinkedIn complete`, linkedinStats);
      if (!useLinkedInLive) {
        await updateCrawlProgress(run._id, {
          linkedin_fetched: synced,
          discovered: (totals.discovered || 0) + synced,
        });
      }
    }

    if (wantsNaukri && browser) {
      naukriStats = results[resultIndex++];
      totals.discovered += naukriStats.discovered;
      totals.validated += naukriStats.validated;
      totals.valid_open += naukriStats.valid_open;
      totals.stale += naukriStats.stale;
      totals.dead += naukriStats.dead;

      const stopped = await shouldStopCrawl(run._id, config);
      if (!stopped && !skipApply && config.autoApplyEnabled) {
        const applyCandidates = await Job.find({
          source: "naukri",
          crawl_run_id: run._id,
          freshness: "fresh",
          url_status: "valid_open",
          tier: { $in: [1, 2] },
          application_status: { $in: ["pending", "failed"] },
          apply_type: "naukri",
        })
          .sort("-match_score")
          .limit(config.maxAutoApply);

        const naukriLog = await createLogger(run._id, "naukri");
        if (applyCandidates.length > 0) {
          await naukriLog.info(`Auto-applying to ${applyCandidates.length} fresh Naukri jobs`);
          const applyStats = await runNaukriApply({
            browser,
            jobs: applyCandidates,
            config,
            log: naukriLog,
            candidate,
          });
          totals.applied = applyStats.applied;
          totals.apply_failed = applyStats.failed;
        } else {
          await naukriLog.info("No eligible fresh jobs for auto-apply (set AUTO_APPLY_ENABLED=true to enable)");
        }
      } else if (!config.autoApplyEnabled) {
        const naukriLog = await createLogger(run._id, "naukri");
        await naukriLog.info("Scrape-only mode — auto-apply disabled (AUTO_APPLY_ENABLED=false)");
      }
    }

    if (wantsLinkedIn && linkedinStats && useLinkedInLive) {
      totals.discovered += linkedinStats.discovered || 0;
      totals.validated += linkedinStats.validated || 0;
      totals.valid_open += linkedinStats.valid_open || 0;
      totals.stale += linkedinStats.stale || 0;
      totals.dead += linkedinStats.dead || 0;
    }

    const freshCount = await getFreshJobCount(run._id);
    const runDoc = await CrawlRun.findById(run._id).lean();
    const wasCancelled = Boolean(runDoc?.cancel_requested);
    const targetReached = freshCount >= config.targetFreshJobs;
    const finalStatus = wasCancelled ? "cancelled" : "completed";

    await CrawlRun.findByIdAndUpdate(run._id, {
      ...totals,
      fresh_found: freshCount,
      status: finalStatus,
      finished_at: new Date(),
      error_message: wasCancelled ? runDoc?.error_message || "Stopped by user" : undefined,
    });

    await log.info(
      wasCancelled
        ? "Crawl cancelled by user"
        : targetReached
          ? `Target reached (${freshCount}/${config.targetFreshJobs} fresh jobs)`
          : "Crawl run completed",
      { ...totals, fresh_found: freshCount }
    );
    return { run_id: run._id, fresh_found: freshCount, ...totals, status: finalStatus };
  } catch (err) {
    const runDoc = await CrawlRun.findById(run._id).lean();
    const status = runDoc?.cancel_requested ? "cancelled" : "failed";
    await CrawlRun.findByIdAndUpdate(run._id, {
      status,
      error_message: err.message,
      finished_at: new Date(),
    });
    await log.error(`Crawl run ${status}: ${err.message}`);
    throw err;
  } finally {
    setActiveBrowser(null);
    if (browser) await browser.close().catch(() => {});
  }
}

async function processPendingRuns() {
  const running = await CrawlRun.findOne({ status: "running", source: { $ne: "multi" } });
  if (running) return null;

  const pending = await CrawlRun.find({
    status: "queued",
    source: { $ne: "multi" },
    live: { $ne: true },
    cancel_requested: { $ne: true },
  })
    .sort("started_at")
    .limit(1);

  if (pending.length === 0) return null;

  const run = pending[0];

  try {
    if (run.agent_loop) {
      const { runAgentLoop } = require("./orchestrator");
      return await runAgentLoop({
        source: run.source,
        triggeredBy: run.triggered_by || "agent",
        runId: run._id,
        live: Boolean(run.live),
      });
    }
    return await runPipeline({
      source: run.source,
      triggeredBy: run.triggered_by || "manual",
      runId: run._id,
    });
  } catch {
    return null;
  }
}

module.exports = { runPipeline, processPendingRuns, getConfig };
