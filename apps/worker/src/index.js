const { connectDb, mongoose } = require("@jobportal/db");
const { startRunner, failStaleRuns } = require("./runner");
const { startScheduler } = require("./scheduler");
const { closeBrowser } = require("./browser");

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/jobportal";

async function main() {
  if (!process.env.APP_ENCRYPTION_KEY) throw new Error("APP_ENCRYPTION_KEY is required");
  await connectDb(MONGODB_URI);
  const interrupted = await failStaleRuns({ all: true });
  if (interrupted) console.log(`Marked ${interrupted} interrupted run(s) as failed`);

  const runner = startRunner({ maxConcurrent: Number(process.env.MAX_CONCURRENT_RUNS) || 3 });
  const scheduler = startScheduler();
  console.log("Worker ready: web crawl hourly at :00, portal crawl every 3h at :30, Naukri refresh 09:15 IST");

  async function shutdown(signal) {
    console.log(`${signal} received, finishing active runs…`);
    scheduler.stop();
    await Promise.race([runner.stop(), new Promise((r) => setTimeout(r, 25000))]);
    await closeBrowser();
    await mongoose.disconnect();
    process.exit(0);
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("Worker failed to start:", err);
  process.exit(1);
});
