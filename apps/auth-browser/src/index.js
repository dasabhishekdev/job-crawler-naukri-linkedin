const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const { connectDb } = require("@jobportal/db");
const { seedCandidates, getActiveCandidate, resolveNaukriStoragePath, hydrateOpenAiEnv } = require("@jobportal/agent");
const { runLiveCrawl } = require("./live-crawl");
const { getRunProgress, requestStop } = require("../../worker/src/progress");
const { closeActiveBrowser } = require("../../worker/src/crawl-control");

const PORT = Number(process.env.AUTH_BROWSER_PORT) || 5000;

async function naukriSessionPath() {
  try {
    const candidate = await getActiveCandidate();
    return resolveNaukriStoragePath(candidate);
  } catch {
    return process.env.NAUKRI_STORAGE_STATE || "/app/data/naukri-storage-state.json";
  }
}

async function sessionConfig(platform) {
  if (platform === "linkedin") {
    return {
      url: "https://www.linkedin.com/login",
      path: process.env.LINKEDIN_STORAGE_STATE || "/app/linkedin-cli/storageState.json",
    };
  }
  if (platform === "naukri") {
    return {
      url: "https://www.naukri.com/nlogin/login",
      path: await naukriSessionPath(),
    };
  }
  return null;
}

let browser = null;
let context = null;
let page = null;
let currentPlatform = null;

let crawlRunning = false;
let crawlRunId = null;
let crawlSource = null;
let crawlError = null;

async function releaseLoginBrowser() {
  if (context) {
    await context.close().catch(() => {});
    context = null;
    page = null;
  }
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
  currentPlatform = null;
}

async function ensureBrowser() {
  if (crawlRunning) {
    throw new Error("Cannot open login while a live crawl is running");
  }
  if (!browser) {
    browser = await chromium.launch({
      headless: false,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    });
  }
  return browser;
}

async function openLogin(platform) {
  const cfg = await sessionConfig(platform);
  if (!cfg) throw new Error(`Unknown platform: ${platform}`);

  const b = await ensureBrowser();
  if (context) {
    await context.close().catch(() => {});
    context = null;
    page = null;
  }

  const contextOptions = { viewport: { width: 1280, height: 720 } };
  if (fs.existsSync(cfg.path)) {
    contextOptions.storageState = cfg.path;
  }

  context = await b.newContext(contextOptions);
  page = await context.newPage();
  await page.goto(cfg.url, { waitUntil: "domcontentloaded", timeout: 90000 });
  currentPlatform = platform;

  return {
    platform,
    url: page.url(),
    message: `Browser opened to ${platform} login. Use the viewer to sign in, then click Save Session.`,
  };
}

async function saveSession(platform) {
  const cfg = await sessionConfig(platform);
  if (!cfg) throw new Error(`Unknown platform: ${platform}`);
  if (!context) {
    throw new Error("No browser session open. Click Open Login first.");
  }
  if (currentPlatform !== platform) {
    throw new Error(`Browser is on ${currentPlatform}. Open ${platform} login first.`);
  }

  const dir = path.dirname(cfg.path);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  await context.storageState({ path: cfg.path });
  return {
    platform,
    saved: true,
    path: cfg.path,
    message: `${platform} session saved successfully.`,
  };
}

async function getStatus() {
  const naukriPath = await naukriSessionPath();
  const linkedinPath = process.env.LINKEDIN_STORAGE_STATE || "/app/linkedin-cli/storageState.json";
  return {
    linkedin: {
      logged_in: fs.existsSync(linkedinPath),
      path: linkedinPath,
      updated_at: fs.existsSync(linkedinPath) ? fs.statSync(linkedinPath).mtime : null,
    },
    naukri: {
      logged_in: fs.existsSync(naukriPath),
      path: naukriPath,
      updated_at: fs.existsSync(naukriPath) ? fs.statSync(naukriPath).mtime : null,
    },
    current_platform: currentPlatform,
    browser_open: Boolean(context),
    crawl_running: crawlRunning,
    crawl_run_id: crawlRunId,
    crawl_source: crawlSource,
    crawl_error: crawlError,
    vnc_url: process.env.VNC_PUBLIC_URL || "http://localhost:6080/vnc.html",
  };
}

async function startLiveCrawl({ runId, source = "naukri" }) {
  if (crawlRunning) {
    throw new Error("A live crawl is already in progress");
  }

  crawlRunning = true;
  crawlRunId = runId;
  crawlSource = source;
  crawlError = null;

  await releaseLoginBrowser();

  try {
    const result = await runLiveCrawl({ runId, source });
    return result;
  } catch (err) {
    crawlError = err.message;
    throw err;
  } finally {
    crawlRunning = false;
    crawlRunId = null;
    crawlSource = null;
  }
}

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "auth-browser" });
});

app.get("/status", async (_req, res) => {
  try {
    res.json(await getStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/open/:platform", async (req, res) => {
  try {
    const result = await openLogin(req.params.platform);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/save/:platform", async (req, res) => {
  try {
    const result = await saveSession(req.params.platform);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/crawl/start", async (req, res) => {
  if (crawlRunning) {
    return res.status(409).json({ error: "A live crawl is already in progress" });
  }

  const runId = req.body.run_id;
  const source = req.body.source || "all";

  if (!runId) {
    return res.status(400).json({ error: "run_id is required" });
  }

  res.json({
    message: `Live crawl started for ${source}. Watch the browser viewer.`,
    run_id: runId,
    source,
    vnc_url: process.env.VNC_PUBLIC_URL || "http://localhost:6080/vnc.html",
  });

  startLiveCrawl({ runId, source }).catch((err) => {
    console.error("[live-crawl] failed:", err.message);
    crawlError = err.message;
    crawlRunning = false;
    crawlRunId = null;
    crawlSource = null;
  });
});

app.post("/crawl/stop", async (req, res) => {
  const runId = req.body.run_id || crawlRunId;
  if (!runId && !crawlRunning) {
    return res.status(404).json({ error: "No live crawl running" });
  }

  try {
    await requestStop(runId, "Stopped by user");
    await closeActiveBrowser();
    res.json({ message: "Live crawl stopped", run_id: runId });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/crawl/status", async (_req, res) => {
  const payload = {
    crawl_running: crawlRunning,
    crawl_run_id: crawlRunId,
    crawl_source: crawlSource,
    crawl_error: crawlError,
    vnc_url: process.env.VNC_PUBLIC_URL || "http://localhost:6080/vnc.html",
  };

  if (crawlRunId) {
    try {
      payload.progress = await getRunProgress(crawlRunId);
    } catch {
      payload.progress = null;
    }
  }

  res.json(payload);
});

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/jobportal";

connectDb(MONGODB_URI)
  .then(() => seedCandidates())
  .then(() => hydrateOpenAiEnv())
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Auth browser API on :${PORT}`);
      console.log(`DISPLAY=${process.env.DISPLAY || ":99"}`);
    });
  })
  .catch((err) => {
    console.error("Auth browser failed to start:", err);
    process.exit(1);
  });

process.on("SIGTERM", async () => {
  await releaseLoginBrowser();
  process.exit(0);
});
