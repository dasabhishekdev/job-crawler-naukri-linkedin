const express = require("express");
const fs = require("fs");

const router = express.Router();
const AUTH_BROWSER_URL = process.env.AUTH_BROWSER_URL || "http://localhost:5000";
const LINKEDIN_SESSION =
  process.env.LINKEDIN_STORAGE_STATE || "/app/linkedin-cli/storageState.json";
const NAUKRI_SESSION =
  process.env.NAUKRI_STORAGE_STATE || "/app/data/naukri-storage-state.json";

function resolveVncUrl(req) {
  const env = process.env.VNC_PUBLIC_URL || "http://localhost:6080/vnc.html";
  if (env && !/localhost|127\.0\.0\.1/i.test(env)) {
    return env.replace(/\?.*$/, "");
  }
  const hostHeader = req?.headers?.["x-forwarded-host"] || req?.headers?.host || "localhost:4000";
  const host = String(hostHeader).split(":")[0] || "localhost";
  return `http://${host}:6080/vnc.html`;
}

function withVncParams(base) {
  return base.includes("?") ? base : `${base}?autoconnect=true&resize=scale`;
}

function sessionInfo(path) {
  const exists = fs.existsSync(path);
  return {
    logged_in: exists,
    path,
    updated_at: exists ? fs.statSync(path).mtime : null,
  };
}

function fallbackStatus(req, error = null) {
  return {
    auth_browser_available: false,
    error,
    linkedin: sessionInfo(LINKEDIN_SESSION),
    naukri: sessionInfo(NAUKRI_SESSION),
    current_platform: null,
    browser_open: false,
    vnc_url: withVncParams(resolveVncUrl(req)),
  };
}

async function proxy(method, path, body = null) {
  const res = await fetch(`${AUTH_BROWSER_URL}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

router.get("/status", async (req, res) => {
  try {
    const status = await proxy("GET", "/status");
    res.json({
      ...status,
      auth_browser_available: true,
      vnc_url: withVncParams(resolveVncUrl(req)),
    });
  } catch (err) {
    res.json(fallbackStatus(req, err.message));
  }
});

router.post("/open/:platform", async (req, res) => {
  try {
    const data = await proxy("POST", `/open/${req.params.platform}`);
    res.json(data);
  } catch (err) {
    res.status(503).json({
      error: `Auth browser unavailable: ${err.message}. Check that auth-browser container is running.`,
    });
  }
});

router.post("/save/:platform", async (req, res) => {
  try {
    const data = await proxy("POST", `/save/${req.params.platform}`);
    res.json(data);
  } catch (err) {
    res.status(503).json({
      error: `Auth browser unavailable: ${err.message}`,
    });
  }
});

module.exports = router;
