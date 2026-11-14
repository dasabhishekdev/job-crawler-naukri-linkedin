const crypto = require("crypto");
const { SearchQuery, Profile } = require("@jobportal/db");

const MIN_ACTIVE_JOB_QUERIES = 6;
const RECENT_MS = 3 * 3600 * 1000;

function queryKey(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}

function planHash(profile) {
  const sorted = (list, n) => [...(list || [])].map(queryKey).sort().slice(0, n);
  const basis = {
    roles: sorted(profile.target_roles, 15),
    skills: sorted(profile.skills, 15),
    cities: sorted(profile.target_locations, 8),
    years: Math.round(Number(profile.experience_years) || 0),
    remote: Boolean(profile.remote_ok),
  };
  return crypto.createHash("sha1").update(JSON.stringify(basis)).digest("hex").slice(0, 16);
}

/** Higher is better: yield per use (good matches count double), a bonus for untried queries, a rest period after use. */
function queryScore(q, now = new Date()) {
  let score = ((q.good_matches || 0) * 2 + (q.new_jobs || 0) + 1) / ((q.uses || 0) + 2);
  if (!q.uses) score += 1.5;
  if (q.last_used_at && now - new Date(q.last_used_at) < RECENT_MS) score *= 0.3;
  return score;
}

function rankQueries(queries, now = new Date()) {
  return [...queries].sort((a, b) => queryScore(b, now) - queryScore(a, now));
}

function shouldRetire(q) {
  return q.origin !== "user" && (q.uses || 0) >= 4 && !(q.new_jobs || 0);
}

function cleanItems(items, max) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const text = String(typeof item === "string" ? item : item?.q || item?.query || "").replace(/\s+/g, " ").trim().slice(0, 120);
    const key = queryKey(text);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ text, key, why: String(item?.why || "").slice(0, 200) });
    if (out.length >= max) break;
  }
  return out;
}

function normalizePlan(parsed) {
  return { jobs: cleanItems(parsed?.job_queries, 30), companies: cleanItems(parsed?.company_queries, 10) };
}

function planPrompt(profile) {
  const companies = (profile.structured_resume?.experience || []).map((e) => e.company).filter(Boolean);
  return `You plan job searches for a candidate. Build a search plan that finds MANY relevant, currently open jobs.

Candidate:
- Headline: ${profile.headline || ""}
- Target roles: ${(profile.target_roles || []).join("; ")}
- Skills: ${(profile.skills || []).slice(0, 25).join(", ")}
- Experience: ~${profile.experience_years || 0} years${companies.length ? ` (worked at ${companies.join(", ")})` : ""}
- Cities: ${(profile.target_locations || []).join(", ") || profile.current_location || "India"}${profile.remote_ok ? " (remote also fine)" : ""}

Return JSON:
{"job_queries":[{"q":"","why":""}],"company_queries":[{"q":"","why":""}]}

Rules:
- 24 job_queries, each 2-7 words, as a person would type into Google or a job board. Mix: exact target titles; alternative/adjacent titles used in Indian companies; skill-led queries ("SAP Ariba procurement jobs"); domain/industry queries ("quick commerce supply chain jobs"); seniority variants that fit ~${profile.experience_years || 0} years. Include the city in about half.
- 8 company_queries that discover employers likely to hire this person in these cities (industries, company types, well-known employers), e.g. "quick commerce companies Bengaluru", "FMCG companies with procurement teams Bengaluru".
- No duplicates or near-duplicates. "why" is one short phrase.`;
}

/** Regenerates the AI search plan when the profile changed or productive queries ran out. */
async function ensurePlan({ ai, profile, userId, log }) {
  const hash = planHash(profile);
  const active = await SearchQuery.countDocuments({ user_id: userId, kind: "jobs", retired: false });
  if (profile.plan_hash === hash && active >= MIN_ACTIVE_JOB_QUERIES) return { planned: 0 };

  const plan = normalizePlan(await ai.json(planPrompt(profile), { maxTokens: 2500, label: "Planning search keywords", reserve: 0.15 }));
  let added = 0;
  for (const [kind, items] of [["jobs", plan.jobs], ["companies", plan.companies]]) {
    for (const item of items) {
      const res = await SearchQuery.updateOne(
        { user_id: userId, kind, key: item.key },
        { $setOnInsert: { text: item.text, why: item.why, origin: "plan" }, $set: { retired: false } },
        { upsert: true }
      );
      if (res.upsertedCount) added++;
    }
  }
  await Profile.updateOne({ _id: profile._id }, { $set: { plan_hash: hash, plan_generated_at: new Date() } });
  profile.plan_hash = hash;
  await log.info(`Search plan ready: ${plan.jobs.length} job keywords and ${plan.companies.length} company searches (${added} new)`);
  return { planned: added };
}

async function pickQueries(userId, kind, count) {
  const queries = await SearchQuery.find({ user_id: userId, kind, retired: false }).lean();
  return rankQueries(queries).slice(0, count);
}

/** stats: Map(queryKey → { results, new_jobs, good_matches }) */
async function recordYield(queries, stats) {
  for (const q of queries) {
    const s = stats.get(q.key) || {};
    const next = {
      ...q,
      uses: (q.uses || 0) + 1,
      new_jobs: (q.new_jobs || 0) + (s.new_jobs || 0),
    };
    await SearchQuery.updateOne(
      { _id: q._id },
      {
        $inc: { uses: 1, results: s.results || 0, new_jobs: s.new_jobs || 0, good_matches: s.good_matches || 0 },
        $set: { last_used_at: new Date(), retired: shouldRetire(next) },
      }
    );
  }
}

module.exports = { planHash, queryKey, rankQueries, queryScore, shouldRetire, normalizePlan, planPrompt, ensurePlan, pickQueries, recordYield };
