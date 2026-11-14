const path = require("path");
const fs = require("fs");
const cron = require("node-cron");
const { connectDb, CrawlRun } = require("@jobportal/db");
const {
  seedCandidates,
  cronExpression,
  hydrateOpenAiEnv,
  getCrawlerSettings,
  queueMultiRun,
} = require("@jobportal/agent");
const { runPipeline, processPendingRuns } = require("./pipeline");
const { runAgentLoop } = require("./orchestrator");
const { runMultiSource } = require("./multi/run-multi");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/jobportal";
const runOnce = process.argv.includes("--once");
const runAgentOnce = process.argv.includes("--agent");

async function ensureDataDir() {
  const statePath = process.env.NAUKRI_STORAGE_STATE || "./data/naukri-storage-state.json";
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const sessions = path.join(dir, "sessions");
  if (!fs.existsSync(sessions)) fs.mkdirSync(sessions, { recursive: true });
}

async function runScheduledAgent() {
  console.log("[cron] Starting scheduled agent run");
  try {
    const result = await runAgentLoop({
      source: "naukri",
      triggeredBy: "schedule",
      live: false,
      headless: true,
    });
    console.log("[cron] Done:", result);
  } catch (err) {
    console.error("[cron] Failed:", err.message);
  }
}

async function queueHourlyMultiRun() {
  try {
    const settings = await getCrawlerSettings();
    if (!settings.hourly_enabled) return;
    const { run, queued } = await queueMultiRun({ triggeredBy: "schedule" });
    console.log(queued ? `[hourly] Queued all-sources run ${run._id}` : `[hourly] Skipped: run ${run._id} still ${run.status}`);
  } catch (err) {
    console.error("[hourly] Failed to queue:", err.message);
  }
}

async function processMultiQueue() {
  if (await CrawlRun.exists({ source: "multi", status: "running" })) return;
  const run = await CrawlRun.findOne({ source: "multi", status: "queued", cancel_requested: { $ne: true } }).sort(
    "started_at"
  );
  if (!run) return;
  const result = await runMultiSource({ runId: run._id, triggeredBy: run.triggered_by });
  console.log("[multi] Run finished:", result);
}

async function failInterruptedMultiRuns() {
  const result = await CrawlRun.updateMany(
    { source: "multi", status: "running" },
    { $set: { status: "failed", error_message: "Worker restarted during the run", finished_at: new Date() } }
  );
  if (result.modifiedCount) console.log(`Marked ${result.modifiedCount} interrupted all-sources run(s) as failed`);
}

async function main() {
  await ensureDataDir();
  await connectDb(MONGODB_URI);
  await seedCandidates();
  await hydrateOpenAiEnv();
  await failInterruptedMultiRuns();
  console.log("Worker connected to MongoDB");

  if (runAgentOnce) {
    console.log("Running one-shot agent loop...");
    const result = await runAgentLoop({ source: "all", triggeredBy: "agent" });
    console.log("Done:", result);
    process.exit(0);
  }

  if (runOnce) {
    console.log("Running one-shot crawl...");
    const result = await runPipeline({ source: "all", triggeredBy: "manual" });
    console.log("Done:", result);
    process.exit(0);
  }

  setInterval(async () => {
    try {
      await hydrateOpenAiEnv();
      await processPendingRuns();
    } catch (err) {
      console.error("[queue] Failed:", err.message);
    }
  }, 15000);

  let multiBusy = false;
  setInterval(async () => {
    if (multiBusy) return;
    multiBusy = true;
    try {
      await hydrateOpenAiEnv();
      await processMultiQueue();
    } catch (err) {
      console.error("[multi] Failed:", err.message);
    } finally {
      multiBusy = false;
    }
  }, 10000);

  if (process.env.AGENT_SCHEDULE_ENABLED !== "false") {
    cron.schedule(
      cronExpression(),
      () => {
        runScheduledAgent();
      },
      { timezone: "Asia/Kolkata" }
    );
    console.log("Scheduled agent: 09:00 and 19:00 Asia/Kolkata");
  } else {
    console.log("Agent schedule disabled (AGENT_SCHEDULE_ENABLED=false)");
  }

  cron.schedule("0 * * * *", queueHourlyMultiRun, { timezone: "Asia/Kolkata" });
  console.log("Hourly all-sources crawl: every hour at :00 when enabled in the dashboard");

  console.log("Listening for queued crawls and agent runs...");
}

main().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});
