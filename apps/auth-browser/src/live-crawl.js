const { connectDb, CrawlRun } = require("@jobportal/db");
const { runPipeline } = require("../../worker/src/pipeline");
const { runAgentLoop } = require("../../worker/src/orchestrator");

async function runLiveCrawl({ runId, source = "naukri" }) {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  await connectDb(uri);
  process.env.HEADLESS = "false";

  const run = await CrawlRun.findById(runId).lean();
  if (run?.agent_loop) {
    return runAgentLoop({
      source,
      triggeredBy: run.triggered_by || "agent",
      runId,
      headless: false,
      live: true,
    });
  }

  return runPipeline({
    source,
    triggeredBy: run?.triggered_by || "manual",
    runId,
    headless: false,
    live: true,
  });
}

module.exports = { runLiveCrawl };
