const express = require("express");
const helmet = require("helmet");
const cookieParser = require("cookie-parser");
const { mongoose } = require("@jobportal/db");
const { sessionMiddleware, requireUser, requireAdmin } = require("./middleware/session");
const { originCheck, apiLimiter } = require("./middleware/security");
const { notFoundHandler, errorHandler } = require("./middleware/errors");
const { authRouter } = require("./routes/auth");
const { profileRouter } = require("./routes/profile");
const { resumeRouter } = require("./routes/resume");
const { settingsRouter } = require("./routes/settings");
const { jobsRouter, generatedRouter } = require("./routes/jobs");
const { runsRouter } = require("./routes/runs");
const { googleRouter } = require("./routes/google");
const { adminRouter } = require("./routes/admin");

function createApp(config) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.get(["/health", "/api/health"], (_req, res) => {
    const up = mongoose.connection.readyState === 1;
    res.status(up ? 200 : 503).json({ status: up ? "ok" : "degraded", db: up });
  });

  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: "same-origin" } }));
  app.use(express.json({ limit: "200kb" }));
  app.use(cookieParser());
  app.use("/api", apiLimiter, originCheck(config), sessionMiddleware(config));
  app.use("/api", (_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  app.use("/api/auth", authRouter(config));
  app.use("/api/google", googleRouter(config));
  app.use("/api/profile", requireUser, profileRouter());
  app.use("/api/resume", requireUser, resumeRouter());
  app.use("/api/settings", requireUser, settingsRouter());
  app.use("/api/jobs", requireUser, jobsRouter());
  app.use("/api/generated-resumes", requireUser, generatedRouter());
  app.use("/api/runs", requireUser, runsRouter());
  app.use("/api/admin", requireAdmin, adminRouter());

  app.use("/api", notFoundHandler);
  app.use(errorHandler);
  return app;
}

module.exports = { createApp };
