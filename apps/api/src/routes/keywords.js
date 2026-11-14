const express = require("express");
const { ResumeProfile, KeywordLibrary } = require("@jobportal/db");
const { generateQueryBatch, computeQueryCount, sanitizeQuery } = require("@jobportal/core");
const { hydrateOpenAiEnv } = require("@jobportal/agent");

const router = express.Router();
const DEFAULT_TARGET = Number(process.env.TARGET_FRESH_JOBS) || 20;
const MAX_QUERIES = 25;

function splitKeywords(envValue, fallback = []) {
  if (!envValue) return [...fallback];
  return envValue
    .split("|")
    .map((k) => k.trim())
    .filter(Boolean);
}

function normalizeText(text, platform = "naukri") {
  const sanitized = sanitizeQuery(text, platform === "linkedin" ? "linkedin" : "naukri");
  return sanitized || String(text || "").trim().replace(/\s+/g, " ");
}

async function upsertKeyword({ text, platform, source }) {
  const normalized = normalizeText(text, platform === "both" ? "naukri" : platform);
  if (!normalized) return null;

  const existing = await KeywordLibrary.findOne({
    platform,
    text: new RegExp(`^${normalized.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i"),
  });

  if (existing) {
    existing.active = true;
    if (source === "manual" || existing.source !== "manual") {
      existing.source = source;
    }
    existing.text = normalized;
    await existing.save();
    return { doc: existing, created: false };
  }

  const doc = await KeywordLibrary.create({
    text: normalized,
    platform,
    source,
    active: true,
  });
  return { doc, created: true };
}

async function persistBatch(queries, platform, source) {
  const saved = [];
  for (const q of queries || []) {
    const result = await upsertKeyword({ text: q, platform, source });
    if (result) saved.push(result.doc);
  }
  return saved;
}

function requestedPlatforms(body) {
  const raw = String(body?.platform || "").toLowerCase();
  if (raw === "naukri" || raw === "linkedin") return [raw];
  return ["naukri", "linkedin"];
}

function emptyBatch() {
  return { queries: [], source: "fallback", reasoning: "", saved: 0 };
}

async function planAndPersist({ resume, queryCount, platforms, save }) {
  const naukriLocation = process.env.NAUKRI_LOCATION || "bengaluru";
  const linkedinLocation = process.env.LINKEDIN_LOCATION || "Bangalore, Karnataka, India";
  const naukriFallback = splitKeywords(process.env.NAUKRI_KEYWORDS, [
    "operations analyst",
    "purchase executive",
  ]);
  const linkedinFallback = splitKeywords(process.env.LINKEDIN_KEYWORDS, [
    "operations analyst logistics",
    "supply chain analyst bangalore",
  ]);

  const tasks = [];
  if (platforms.includes("naukri")) {
    tasks.push(
      generateQueryBatch({
        resumeText: resume.text,
        platform: "naukri",
        count: queryCount,
        location: naukriLocation,
        fallbackKeywords: naukriFallback,
      }).then((batch) => ["naukri", batch])
    );
  }
  if (platforms.includes("linkedin")) {
    tasks.push(
      generateQueryBatch({
        resumeText: resume.text,
        platform: "linkedin",
        count: queryCount,
        location: linkedinLocation,
        fallbackKeywords: linkedinFallback,
      }).then((batch) => ["linkedin", batch])
    );
  }

  const planned = Object.fromEntries(await Promise.all(tasks));
  const naukri = planned.naukri || emptyBatch();
  const linkedin = planned.linkedin || emptyBatch();

  let naukriSaved = [];
  let linkedinSaved = [];
  if (save) {
    const persistTasks = [];
    if (planned.naukri) {
      persistTasks.push(
        persistBatch(naukri.queries, "naukri", naukri.source === "ai" ? "ai" : "manual").then(
          (docs) => {
            naukriSaved = docs;
          }
        )
      );
    }
    if (planned.linkedin) {
      persistTasks.push(
        persistBatch(linkedin.queries, "linkedin", linkedin.source === "ai" ? "ai" : "manual").then(
          (docs) => {
            linkedinSaved = docs;
          }
        )
      );
    }
    await Promise.all(persistTasks);
  }

  return {
    naukri: { ...naukri, saved: naukriSaved.length },
    linkedin: { ...linkedin, saved: linkedinSaved.length },
    keywords: [...naukriSaved, ...linkedinSaved],
  };
}

router.get("/", async (req, res) => {
  try {
    const filter = {};
    if (req.query.platform) filter.platform = req.query.platform;
    if (req.query.source) filter.source = req.query.source;
    if (req.query.active === "false") filter.active = false;
    else if (req.query.active !== "all") filter.active = true;

    const keywords = await KeywordLibrary.find(filter)
      .sort({ last_used_at: -1, updatedAt: -1, text: 1 })
      .lean();
    res.json({ keywords, total: keywords.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const platform = ["naukri", "linkedin", "both"].includes(req.body.platform)
      ? req.body.platform
      : "naukri";
    const text = normalizeText(req.body.text, platform === "both" ? "naukri" : platform);
    if (!text) return res.status(400).json({ error: "Keyword text is required" });

    const { doc, created } = await upsertKeyword({
      text,
      platform,
      source: "manual",
    });
    res.status(created ? 201 : 200).json({ keyword: doc, created });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "Keyword already exists for this platform" });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post("/generate", async (req, res) => {
  try {
    await hydrateOpenAiEnv();
    const resume = await ResumeProfile.findOne({ is_active: true }).lean();
    if (!resume) return res.status(400).json({ error: "Upload a resume first" });

    const targetFreshJobs = Math.min(
      100,
      Math.max(5, Number(req.body.target_fresh_jobs) || DEFAULT_TARGET)
    );
    const freshPerKeyword = Math.min(
      10,
      Math.max(5, Number(req.body.fresh_per_keyword_threshold) || 8)
    );
    const queryCount = Math.min(
      MAX_QUERIES,
      Number(req.body.query_count) || computeQueryCount(targetFreshJobs, freshPerKeyword)
    );

    const planned = await planAndPersist({
      resume,
      queryCount,
      platforms: requestedPlatforms(req.body),
      save: true,
    });

    res.json({
      target_fresh_jobs: targetFreshJobs,
      fresh_per_keyword_threshold: freshPerKeyword,
      query_count: queryCount,
      platforms: requestedPlatforms(req.body),
      ...planned,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/preview", async (req, res) => {
  try {
    await hydrateOpenAiEnv();
    const resume = await ResumeProfile.findOne({ is_active: true }).lean();
    if (!resume) return res.status(400).json({ error: "Upload a resume first" });

    const targetFreshJobs = Math.min(
      100,
      Math.max(5, Number(req.body.target_fresh_jobs) || DEFAULT_TARGET)
    );
    const freshPerKeyword = Math.min(
      10,
      Math.max(5, Number(req.body.fresh_per_keyword_threshold) || 8)
    );
    const queryCount = computeQueryCount(targetFreshJobs, freshPerKeyword);
    const save = req.body.save === true || req.query.save === "true";

    const planned = await planAndPersist({
      resume,
      queryCount,
      platforms: requestedPlatforms(req.body),
      save,
    });

    res.json({
      target_fresh_jobs: targetFreshJobs,
      fresh_per_keyword_threshold: freshPerKeyword,
      query_count: queryCount,
      saved: save,
      platforms: requestedPlatforms(req.body),
      naukri: planned.naukri,
      linkedin: planned.linkedin,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch("/:id", async (req, res) => {
  try {
    const keyword = await KeywordLibrary.findById(req.params.id);
    if (!keyword) return res.status(404).json({ error: "Keyword not found" });

    if (req.body.text != null) {
      const platform = keyword.platform === "both" ? "naukri" : keyword.platform;
      const text = normalizeText(req.body.text, platform);
      if (!text) return res.status(400).json({ error: "Keyword text is required" });
      keyword.text = text;
    }
    if (req.body.platform && ["naukri", "linkedin", "both"].includes(req.body.platform)) {
      keyword.platform = req.body.platform;
    }
    if (typeof req.body.active === "boolean") {
      keyword.active = req.body.active;
    }

    await keyword.save();
    res.json({ keyword });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ error: "Keyword already exists for this platform" });
    }
    res.status(500).json({ error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const hard = req.query.hard === "true";
    const keyword = await KeywordLibrary.findById(req.params.id);
    if (!keyword) return res.status(404).json({ error: "Keyword not found" });

    if (hard) {
      await keyword.deleteOne();
      return res.json({ deleted: true, hard: true });
    }

    keyword.active = false;
    await keyword.save();
    res.json({ keyword, deleted: false, soft: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
