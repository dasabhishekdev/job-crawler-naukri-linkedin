const express = require("express");
const {
  hydrateOpenAiEnv,
  getPublicOpenAiSettings,
  saveOpenAiSettings,
  checkOpenAiKey,
} = require("@jobportal/agent");

const router = express.Router();

router.get("/openai", async (_req, res) => {
  try {
    await hydrateOpenAiEnv();
    res.json(await getPublicOpenAiSettings());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/openai/check", async (req, res) => {
  try {
    const result = await checkOpenAiKey({ apiKey: req.body?.api_key });
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message, verified: false });
  }
});

router.put("/openai", async (req, res) => {
  try {
    const saved = await saveOpenAiSettings({
      apiKey: req.body.api_key,
      model: req.body.model,
    });
    res.json(saved);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
