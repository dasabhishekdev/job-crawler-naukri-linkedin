const express = require("express");
const cors = require("cors");
const { connectDb } = require("@jobportal/db");
const jobsRouter = require("./routes/jobs");
const runsRouter = require("./routes/runs");
const logsRouter = require("./routes/logs");
const crawlRouter = require("./routes/crawl");
const statsRouter = require("./routes/stats");
const exportRouter = require("./routes/export");
const authRouter = require("./routes/auth");
const resumeRouter = require("./routes/resume");
const keywordsRouter = require("./routes/keywords");

const PORT = Number(process.env.API_PORT) || 4000;
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/jobportal";

async function main() {
  await connectDb(MONGODB_URI);

  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "jobportal-api" });
  });

  app.use("/api/jobs", jobsRouter);
  app.use("/api/runs", runsRouter);
  app.use("/api/logs", logsRouter);
  app.use("/api/crawl", crawlRouter);
  app.use("/api/stats", statsRouter);
  app.use("/api/export", exportRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/resume", resumeRouter);
  app.use("/api/keywords", keywordsRouter);

  app.listen(PORT, () => {
    console.log(`API listening on http://localhost:${PORT}`);
  });
}

main().catch((err) => {
  console.error("API failed to start:", err);
  process.exit(1);
});
