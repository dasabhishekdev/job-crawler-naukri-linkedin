const express = require("express");
const { z } = require("zod");
const { Profile, SearchQuery, VisitedPage, AiUsage, Run, mongoose, startOfDayIst } = require("@jobportal/db");
const { modelInfo, PROVIDER_LABELS } = require("@jobportal/ai");
const { notFound } = require("../lib/http-error");

const DASHBOARDS = {
  cursor: { label: "Cursor / Grok dashboard", url: "https://grok.com/dashboard" },
  openai: { label: "OpenAI usage", url: "https://platform.openai.com/usage" },
};

function queryKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}

function publicQuery(q) {
  return {
    id: String(q._id),
    kind: q.kind,
    text: q.text,
    why: q.why || "",
    origin: q.origin,
    uses: q.uses,
    results: q.results,
    new_jobs: q.new_jobs,
    good_matches: q.good_matches,
    last_used_at: q.last_used_at || null,
    retired: q.retired,
  };
}

function agentRouter() {
  const router = express.Router();

  router.get("/memory", async (req, res) => {
    const userId = req.user._id;
    const [profile, queries, visited, visitStats] = await Promise.all([
      Profile.findOne({ user_id: userId }, "career_pages plan_generated_at last_company_discovery_at").lean(),
      SearchQuery.find({ user_id: userId }).sort({ retired: 1, good_matches: -1, new_jobs: -1, uses: 1 }).limit(150).lean(),
      VisitedPage.find({ user_id: userId }).sort({ last_at: -1 }).limit(100).lean(),
      VisitedPage.aggregate([
        { $match: { user_id: new mongoose.Types.ObjectId(String(userId)) } },
        { $group: { _id: null, pages: { $sum: 1 }, visits: { $sum: "$visits" }, domains: { $addToSet: "$domain" } } },
      ]),
    ]);
    const stats = visitStats[0] || {};
    res.json({
      plan_generated_at: profile?.plan_generated_at || null,
      last_company_discovery_at: profile?.last_company_discovery_at || null,
      companies: (profile?.career_pages || []).map((p) => ({
        id: String(p._id),
        name: p.name,
        url: p.url,
        enabled: p.enabled !== false,
        source: p.source || "manual",
        reason: p.reason || "",
        ats: p.ats || "",
        last_crawled_at: p.last_crawled_at || null,
        last_found: p.last_found || 0,
        total_found: p.total_found || 0,
        failures: p.failures || 0,
        last_error: p.last_error || "",
      })),
      queries: queries.map(publicQuery),
      visited: visited.map((v) => ({
        url: v.url,
        domain: v.domain,
        kind: v.kind,
        visits: v.visits,
        last_at: v.last_at,
        last_status: v.last_status,
        jobs_found: v.jobs_found,
        note: v.note || "",
      })),
      totals: { pages: stats.pages || 0, visits: stats.visits || 0, domains: (stats.domains || []).filter(Boolean).length },
    });
  });

  router.post("/queries", async (req, res) => {
    const { text, kind } = z
      .object({ text: z.string().trim().min(2, "Enter a search keyword.").max(120), kind: z.enum(["jobs", "companies"]).default("jobs") })
      .parse(req.body);
    const key = queryKey(text);
    const q = await SearchQuery.findOneAndUpdate(
      { user_id: req.user._id, kind, key },
      { $set: { retired: false, origin: "user" }, $setOnInsert: { text, why: "Added by you" } },
      { upsert: true, new: true }
    ).lean();
    res.status(201).json({ query: publicQuery(q) });
  });

  router.patch("/queries/:id", async (req, res) => {
    const { retired } = z.object({ retired: z.boolean() }).parse(req.body);
    const q = await SearchQuery.findOneAndUpdate({ _id: req.params.id, user_id: req.user._id }, { $set: { retired } }, { new: true }).lean();
    if (!q) throw notFound("Keyword not found.");
    res.json({ query: publicQuery(q) });
  });

  router.post("/plan/refresh", async (req, res) => {
    await Profile.updateOne({ user_id: req.user._id }, { $unset: { plan_hash: 1 } });
    res.json({ ok: true, message: "New search keywords will be planned at the start of the next search." });
  });

  return router;
}

function usageRouter() {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const userId = new mongoose.Types.ObjectId(String(req.user._id));
    const today = startOfDayIst();
    const weekAgo = new Date(today.getTime() - 6 * 86400000);
    const sum = { tokens: { $sum: "$total_tokens" }, cost: { $sum: { $ifNull: ["$est_cost_usd", 0] } }, calls: { $sum: 1 } };

    const [todayRow, days, purposes, models, runs] = await Promise.all([
      AiUsage.aggregate([{ $match: { user_id: userId, created_at: { $gte: today } } }, { $group: { _id: null, ...sum } }]),
      AiUsage.aggregate([
        { $match: { user_id: userId, created_at: { $gte: weekAgo } } },
        { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$created_at", timezone: "Asia/Kolkata" } }, ...sum } },
        { $sort: { _id: 1 } },
      ]),
      AiUsage.aggregate([
        { $match: { user_id: userId, created_at: { $gte: weekAgo } } },
        { $group: { _id: { $arrayElemAt: [{ $split: ["$purpose", ":"] }, 0] }, ...sum } },
        { $sort: { tokens: -1 } },
        { $limit: 8 },
      ]),
      AiUsage.aggregate([
        { $match: { user_id: userId, created_at: { $gte: weekAgo } } },
        { $group: { _id: { provider: "$provider", model: "$model" }, included: { $max: "$included_in_plan" }, ...sum } },
        { $sort: { tokens: -1 } },
      ]),
      AiUsage.aggregate([
        { $match: { user_id: userId, run_id: { $ne: null } } },
        { $group: { _id: "$run_id", at: { $max: "$created_at" }, ...sum } },
        { $sort: { at: -1 } },
        { $limit: 10 },
      ]),
    ]);
    const runKinds = new Map(
      (await Run.find({ _id: { $in: runs.map((r) => r._id) } }, "kind triggered_by").lean()).map((r) => [String(r._id), r])
    );

    const provider = req.user.ai?.provider || "";
    const model = provider ? req.user.ai?.models?.[provider] : "";
    const budget = req.user.crawler?.daily_token_budget ?? 1500000;
    const t = todayRow[0] || { tokens: 0, cost: 0, calls: 0 };
    const dayMap = new Map(days.map((d) => [d._id, d]));
    const last7 = Array.from({ length: 7 }, (_, i) => {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date(weekAgo.getTime() + i * 86400000 + 3600000));
      const d = dayMap.get(day);
      return { day, tokens: d?.tokens || 0, cost: d?.cost || 0, calls: d?.calls || 0 };
    });

    res.json({
      today: { tokens: t.tokens, est_cost_usd: t.cost, calls: t.calls, budget, remaining: budget ? Math.max(0, budget - t.tokens) : null },
      last7,
      by_purpose: purposes.map((p) => ({ purpose: p._id || "Other", tokens: p.tokens, est_cost_usd: p.cost, calls: p.calls })),
      by_model: models.map((m) => ({ provider: m._id.provider, model: m._id.model, included_in_plan: Boolean(m.included), tokens: m.tokens, est_cost_usd: m.cost, calls: m.calls })),
      recent_runs: runs.map((r) => ({ run_id: String(r._id), kind: runKinds.get(String(r._id))?.kind || "", at: r.at, tokens: r.tokens, est_cost_usd: r.cost, calls: r.calls })),
      current: provider ? { provider, provider_label: PROVIDER_LABELS[provider], model, ...modelInfo(provider, model) } : null,
      dashboard: DASHBOARDS[provider] || null,
      note:
        "Token counts are exact. Costs are estimates at list price: Cursor's own models (Composer 2.5, Grok) are included in paid Cursor plans' weekly pool, so they may cost nothing extra. Your remaining weekly pool is shown on your Cursor/Grok dashboard; it is not available through the API.",
    });
  });

  return router;
}

module.exports = { agentRouter, usageRouter };
