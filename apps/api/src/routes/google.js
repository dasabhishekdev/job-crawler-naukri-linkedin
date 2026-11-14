const express = require("express");
const { getActiveCandidate, getCrawlerSettings } = require("@jobportal/agent");
const { getAuthUrl, connectWithCode, disconnectGoogle, googleStatus, syncCandidateSheet } = require("@jobportal/google");

const router = express.Router();

function webUrl(query) {
  const base = (process.env.WEB_PUBLIC_URL || "http://localhost:3006").replace(/\/+$/, "");
  return `${base}/?${new URLSearchParams(query).toString()}`;
}

router.get("/status", async (_req, res) => {
  try {
    res.json(await googleStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/auth-url", async (_req, res) => {
  try {
    res.json({ url: await getAuthUrl() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/oauth/callback", async (req, res) => {
  if (req.query.error) return res.redirect(webUrl({ google: "error", message: String(req.query.error) }));
  try {
    const { email } = await connectWithCode(String(req.query.code || ""), String(req.query.state || ""));
    res.redirect(webUrl({ google: "connected", email }));
  } catch (err) {
    res.redirect(webUrl({ google: "error", message: err.message }));
  }
});

router.post("/disconnect", async (_req, res) => {
  try {
    await disconnectGoogle();
    res.json(await googleStatus());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/sync", async (_req, res) => {
  try {
    const [candidate, settings] = await Promise.all([getActiveCandidate(), getCrawlerSettings()]);
    const result = await syncCandidateSheet(candidate, { minFit: settings.min_fit_to_sync });
    if (!result) return res.status(400).json({ error: "Connect Google Drive first" });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
