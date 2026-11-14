const express = require("express");
const { z } = require("zod");
const { AI_PROVIDERS, Resume, enqueueRun } = require("@jobportal/db");
const { verifyProviderKey, listProviderModels, encryptSecret, decryptSecret, last4, PROVIDERS } = require("@jobportal/ai");
const { badRequest } = require("../lib/http-error");
const { publicAi, publicCrawler, publicGoogle } = require("../lib/serialize");

const provider = z.enum(AI_PROVIDERS);
const keySchema = z.object({ provider, api_key: z.string().trim().min(10, "Paste the full API key.").max(400) });
const aiSchema = z.object({ provider, model: z.string().trim().min(1).max(100).regex(/^[\w.:/-]+$/, "Invalid model id") });
const crawlerSchema = z
  .object({
    hourly_enabled: z.boolean(),
    web_search: z.boolean(),
    career_pages: z.boolean(),
    max_job_age_days: z.coerce.number().int().min(1).max(60),
    searches_per_run: z.coerce.number().int().min(1).max(6),
    jobs_per_search: z.coerce.number().int().min(3).max(15),
    min_match_to_sheet: z.coerce.number().int().min(0).max(100),
  })
  .partial();

function settingsRouter() {
  const router = express.Router();

  function settingsPayload(user, extra = {}) {
    return { ai: publicAi(user), crawler: publicCrawler(user), google: publicGoogle(user), ...extra };
  }

  router.get("/", (req, res) => {
    res.json(settingsPayload(req.user));
  });

  router.put("/ai-key", async (req, res) => {
    const body = keySchema.parse(req.body);
    const verified = await verifyProviderKey(body.provider, body.api_key);
    const user = req.user;
    user.ai.keys[body.provider] = {
      ciphertext: encryptSecret(body.api_key),
      last4: last4(body.api_key),
      verified_at: new Date(),
      error: "",
    };
    const ids = verified.models.map((m) => m.id);
    if (!ids.includes(user.ai.models[body.provider])) {
      const fallback = PROVIDERS[body.provider].defaultModel;
      user.ai.models[body.provider] = ids.includes(fallback) ? fallback : ids[0] || fallback;
    }
    if (!user.ai.provider || !user.ai.keys[user.ai.provider]?.ciphertext) user.ai.provider = body.provider;
    await user.save();

    const resume = await Resume.findOne({ user_id: user._id, is_current: true }, "parse_status").lean();
    if (resume && resume.parse_status !== "done" && resume.parse_status !== "parsing") {
      await enqueueRun({ userId: user._id, kind: "parse_resume", triggeredBy: "system" });
    }
    res.json(settingsPayload(user, { models: verified.models }));
  });

  router.delete("/ai-key/:provider", async (req, res) => {
    const p = provider.parse(req.params.provider);
    const user = req.user;
    user.ai.keys[p] = undefined;
    if (user.ai.provider === p) {
      user.ai.provider = AI_PROVIDERS.find((other) => other !== p && user.ai.keys[other]?.ciphertext) || "";
    }
    await user.save();
    res.json(settingsPayload(user));
  });

  router.get("/ai-models/:provider", async (req, res) => {
    const p = provider.parse(req.params.provider);
    const stored = req.user.ai.keys?.[p];
    if (!stored?.ciphertext) throw badRequest("Save a key for this provider first.");
    res.json({ models: await listProviderModels(p, decryptSecret(stored.ciphertext)) });
  });

  router.put("/ai", async (req, res) => {
    const body = aiSchema.parse(req.body);
    const user = req.user;
    if (!user.ai.keys?.[body.provider]?.ciphertext) throw badRequest("Save a key for this provider first.");
    user.ai.provider = body.provider;
    user.ai.models[body.provider] = body.model;
    await user.save();
    res.json(settingsPayload(user));
  });

  router.put("/crawler", async (req, res) => {
    const patch = crawlerSchema.parse(req.body);
    Object.assign(req.user.crawler, patch);
    await req.user.save();
    res.json(settingsPayload(req.user));
  });

  return router;
}

module.exports = { settingsRouter };
