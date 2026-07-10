const path = require("path");
const fs = require("fs");
const { connectDb } = require("@jobportal/db");
const { runPipeline, processPendingRuns } = require("./pipeline");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/jobportal";
const runOnce = process.argv.includes("--once");

async function ensureDataDir() {
  const statePath = process.env.NAUKRI_STORAGE_STATE || "./data/naukri-storage-state.json";
  const dir = path.dirname(statePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function main() {
  await ensureDataDir();
  await connectDb(MONGODB_URI);
  console.log("Worker connected to MongoDB");
  console.log("Manual crawl mode only — trigger crawls from the UI");

  if (runOnce) {
    console.log("Running one-shot crawl...");
    const result = await runPipeline({ source: "all", triggeredBy: "manual" });
    console.log("Done:", result);
    process.exit(0);
  }

  setInterval(async () => {
    try {
      await processPendingRuns();
    } catch (err) {
      console.error("[manual] Failed:", err.message);
    }
  }, 15000);

  console.log("Listening for manual crawl triggers...");
}

main().catch((err) => {
  console.error("Worker failed:", err);
  process.exit(1);
});
