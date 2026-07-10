const OpenAI = require("openai");

const MODEL = process.env.OPENAI_MODEL || "gpt-5.4-mini";

const PLATFORM_DEFAULTS = {
  naukri: ["operations analyst", "purchase executive", "logistics analyst", "warehouse executive"],
  linkedin: [
    "operations analyst logistics",
    "supply chain analyst bangalore",
    "procurement analyst",
    "warehouse operations analyst",
  ],
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isGpt5Family(model) {
  return /gpt-5/i.test(model || MODEL);
}

function sanitizeQuery(query, platform) {
  let q = String(query || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, " ");
  const maxWords = platform === "naukri" ? 5 : 8;
  q = q.split(" ").filter(Boolean).slice(0, maxWords).join(" ");
  return q;
}

function uniqueQueries(queries, platform) {
  const seen = new Set();
  const out = [];
  for (const raw of queries || []) {
    const q = sanitizeQuery(raw, platform);
    if (!q) continue;
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(q);
  }
  return out;
}

/**
 * How many search queries to pre-generate for a crawl run.
 * targetFreshJobs / freshPerKeyword + buffer for low-yield queries.
 */
function computeQueryCount(targetFreshJobs, freshPerKeyword) {
  const target = Math.max(1, Number(targetFreshJobs) || 20);
  const perQuery = Math.min(10, Math.max(1, Number(freshPerKeyword) || 8));
  return Math.min(25, Math.max(3, Math.ceil(target / perQuery) + 2));
}

function buildChatCompletionParams({ model, messages, maxTokens = 512 }) {
  const params = {
    model,
    messages,
    response_format: { type: "json_object" },
  };

  if (isGpt5Family(model)) {
    params.max_completion_tokens = maxTokens;
    params.reasoning_effort = "none";
  } else {
    params.max_tokens = maxTokens;
    params.temperature = 0.8;
  }

  return params;
}

function platformRules(platform, count) {
  if (platform === "naukri") {
    return [
      `Generate exactly ${count} DISTINCT Naukri job search queries.`,
      "Rules for Naukri:",
      "- Short Indian job-portal style: 2-4 words each (job title focus).",
      "- Examples: purchase executive, operations analyst, logistics coordinator.",
      "- Do NOT copy LinkedIn-style long phrases.",
      "- Derive titles from the resume (roles, skills, industries) — not generic filler.",
    ].join("\n");
  }
  return [
    `Generate exactly ${count} DISTINCT LinkedIn job search queries.`,
    "Rules for LinkedIn:",
    "- 3-6 words: combine role + domain/skill/location context.",
    "- Examples: operations analyst supply chain, procurement executive bangalore.",
    "- Must differ from Naukri short-title style — more descriptive phrases.",
    "- Derive from resume experience and target roles.",
  ].join("\n");
}

function buildBatchPrompt({ resumeText, platform, count, location, usedQueries = [] }) {
  const used = usedQueries.length ? usedQueries.join(", ") : "none";

  return `You generate job search queries for ${platform} in India.

Resume excerpt:
${(resumeText || "").slice(0, 8000)}

Location: ${location || "Bangalore, India"}
Already used (do NOT repeat or near-duplicate): ${used}

${platformRules(platform, count)}

All queries must be unique. Base them on the resume — not a fixed template list.

Respond JSON only:
{"queries":["query one","query two",...],"reasoning":"one sentence"}`;
}

function buildSinglePrompt(opts) {
  const used = opts.usedQueries?.length ? opts.usedQueries.join(", ") : "none";
  const stats = opts.recentStats?.length
    ? opts.recentStats.map((s) => `"${s.query}": ${s.fresh} fresh`).join("; ")
    : "none yet";

  return `You generate job search queries for ${opts.platform}.

Resume excerpt:
${(opts.resumeText || "").slice(0, 8000)}

Location: ${opts.location || "Bangalore, India"}
Already used queries (do NOT repeat): ${used}
Results so far: ${stats}

${platformRules(opts.platform, 1).replace("exactly 1", "ONE new")}

Respond JSON only: {"query":"...","reasoning":"one sentence"}`;
}

function pickFallbackKeyword(fallbackKeywords, platform, index) {
  const pool = (fallbackKeywords || []).filter(Boolean);
  if (pool.length === 0) {
    const defaults = PLATFORM_DEFAULTS[platform] || PLATFORM_DEFAULTS.naukri;
    return defaults[index % defaults.length];
  }
  return pool[index % pool.length];
}

function buildFallbackBatch(platform, fallbackKeywords, count) {
  const queries = [];
  for (let i = 0; i < count; i++) {
    queries.push(pickFallbackKeyword(fallbackKeywords, platform, i));
  }
  return uniqueQueries(queries, platform);
}

async function generateQueryBatch(opts, { retries = 4 } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  const count = Math.max(1, Math.min(25, Number(opts.count) || 5));
  const platform = opts.platform === "linkedin" ? "linkedin" : "naukri";

  if (!apiKey) {
    return {
      queries: buildFallbackBatch(platform, opts.fallbackKeywords, count),
      reasoning: "OPENAI_API_KEY not set — platform fallback keywords",
      source: "fallback",
    };
  }
  if (!opts.resumeText?.trim()) {
    throw new Error("Resume text is empty");
  }

  const model = process.env.OPENAI_MODEL || MODEL;
  const client = new OpenAI({
    apiKey,
    timeout: 120000,
    maxRetries: 2,
  });

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.chat.completions.create(
        buildChatCompletionParams({
          model,
          maxTokens: 800,
          messages: [{ role: "user", content: buildBatchPrompt({ ...opts, count, platform }) }],
        })
      );

      const raw = response.choices[0]?.message?.content?.trim() || "";
      if (!raw) throw new Error("OpenAI returned empty content");

      const parsed = JSON.parse(raw);
      let queries = uniqueQueries(parsed.queries || [], platform);

      if (queries.length === 0 && parsed.query) {
        queries = uniqueQueries([parsed.query], platform);
      }

      if (queries.length === 0) throw new Error("OpenAI returned no valid queries");

      return {
        queries: queries.slice(0, count),
        reasoning: parsed.reasoning || "",
        source: "ai",
      };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1500 * attempt);
    }
  }

  if (opts.log) {
    await opts.log.warn(`AI batch failed (${platform}): ${lastErr.message} — using fallback`);
  }

  return {
    queries: buildFallbackBatch(platform, opts.fallbackKeywords, count),
    reasoning: `fallback after AI error: ${lastErr.message}`,
    source: "fallback",
  };
}

async function generateNextQuery(opts, { retries = 4 } = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");
  if (!opts.resumeText?.trim()) throw new Error("Resume text is empty");

  const model = process.env.OPENAI_MODEL || MODEL;
  const client = new OpenAI({
    apiKey,
    timeout: 90000,
    maxRetries: 2,
  });

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const response = await client.chat.completions.create(
        buildChatCompletionParams({
          model,
          maxTokens: 256,
          messages: [{ role: "user", content: buildSinglePrompt(opts) }],
        })
      );

      const raw = response.choices[0]?.message?.content?.trim() || "";
      if (!raw) throw new Error("OpenAI returned empty content");

      const parsed = JSON.parse(raw);
      const query = sanitizeQuery(parsed.query, opts.platform);
      if (!query) throw new Error("OpenAI returned empty query");
      return {
        query,
        reasoning: parsed.reasoning || "",
        source: "ai",
      };
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await sleep(1500 * attempt);
    }
  }
  throw lastErr;
}

function createPlanner({
  resumeText,
  fallbackKeywords = [],
  location,
  log,
  queryQueue = [],
  platform = "naukri",
  allowTopUp = true,
  querySourceLabel = "ai",
}) {
  const queue = [...queryQueue];
  const usedQueries = [];
  const statsByPlatform = [];
  let fallbackIndex = 0;
  let topUpAttempts = 0;
  const MAX_TOP_UPS = 3;

  async function refillQueue() {
    if (!allowTopUp) return false;
    if (topUpAttempts >= MAX_TOP_UPS) return false;
    topUpAttempts += 1;
    try {
      const batch = await generateQueryBatch({
        resumeText,
        platform,
        count: 3,
        location,
        usedQueries,
        fallbackKeywords,
        log,
      });
      const fresh = batch.queries.filter((q) => !usedQueries.includes(q));
      queue.push(...fresh);
      if (log && fresh.length) {
        await log.info(`AI top-up (${platform}): +${fresh.length} queries`, { queries: fresh });
      }
      return fresh.length > 0;
    } catch (err) {
      if (log) await log.warn(`Query top-up failed (${platform}): ${err.message}`);
      return false;
    }
  }

  async function next() {
    if (queue.length === 0) {
      await refillQueue();
    }

    if (queue.length > 0) {
      const query = queue.shift();
      usedQueries.push(query);
      return {
        query,
        reasoning: "from planned query batch",
        source: querySourceLabel,
        fromQueue: true,
      };
    }

    if (!allowTopUp) {
      return { done: true, query: null, source: querySourceLabel };
    }

    try {
      const result = await generateNextQuery({
        resumeText,
        platform,
        usedQueries,
        recentStats: statsByPlatform,
        location,
      });
      usedQueries.push(result.query);
      return result;
    } catch (err) {
      if (log) {
        await log.warn(`AI keyword failed (${platform}): ${err.message} — using fallback`);
      }
      const query = pickFallbackKeyword(fallbackKeywords, platform, fallbackIndex);
      fallbackIndex += 1;
      usedQueries.push(query);
      return { query, reasoning: "fallback keyword", source: "fallback" };
    }
  }

  function recordFresh(query, freshCount) {
    const existing = statsByPlatform.find((s) => s.query === query);
    if (existing) existing.fresh = freshCount;
    else statsByPlatform.push({ query, fresh: freshCount });
  }

  function remainingCount() {
    return queue.length;
  }

  return { next, recordFresh, usedQueries, remainingCount };
}

async function seedPlatformQuery({ resumeText, platform, location, fallbackKeywords, log }) {
  const batch = await generateQueryBatch({
    resumeText,
    platform,
    count: 1,
    location,
    fallbackKeywords,
    log,
  });
  const query = batch.queries[0] || pickFallbackKeyword(fallbackKeywords, platform, 0);
  return {
    query,
    reasoning: batch.reasoning,
    source: batch.source,
  };
}

async function planQueriesForCrawl({
  resumeText,
  platform,
  location,
  targetFreshJobs,
  freshPerKeyword,
  fallbackKeywords,
  log,
}) {
  const count = computeQueryCount(targetFreshJobs, freshPerKeyword);
  const batch = await generateQueryBatch({
    resumeText,
    platform,
    count,
    location,
    fallbackKeywords,
    log,
  });

  if (log) {
    await log.info(
      `Planned ${batch.queries.length} ${platform} queries (target ${targetFreshJobs} fresh, ${freshPerKeyword}/query)`,
      { queries: batch.queries, source: batch.source }
    );
  }

  return { ...batch, queryCount: count };
}

module.exports = {
  generateNextQuery,
  generateQueryBatch,
  computeQueryCount,
  planQueriesForCrawl,
  createPlanner,
  seedPlatformQuery,
  sanitizeQuery,
  PLATFORM_DEFAULTS,
  MODEL,
  buildChatCompletionParams,
};
