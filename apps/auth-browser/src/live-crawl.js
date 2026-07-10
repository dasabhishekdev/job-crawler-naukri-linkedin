const { connectDb } = require("@jobportal/db");
const { runPipeline } = require("../../worker/src/pipeline");

async function runLiveCrawl({ runId, source = "naukri" }) {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error("MONGODB_URI is not set");

  await connectDb(uri);
  process.env.HEADLESS = "false";

  return runPipeline({
    source,
    triggeredBy: "manual",
    runId,
    headless: false,
    live: true,
  });
}

module.exports = { runLiveCrawl };
