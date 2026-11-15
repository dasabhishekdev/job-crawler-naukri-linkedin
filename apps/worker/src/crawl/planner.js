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
  // Keep user-saved queries forever; recycle AI plan/mint queries that stop yielding.
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

function profileBrief(profile) {
  const companies = (profile.structured_resume?.experience || []).map((e) => e.company).filter(Boolean);
  return `Candidate:
- Headline: ${profile.headline || ""}
- Target roles: ${(profile.target_roles || []).join("; ")}
- Skills: ${(profile.skills || []).slice(0, 25).join(", ")}
- Experience: ~${profile.experience_years || 0} years${companies.length ? ` (worked at ${companies.join(", ")})` : ""}
- Cities: ${(profile.target_locations || []).join(", ") || profile.current_location || "India"}${profile.remote_ok ? " (remote also fine)" : ""}`;
}

function planPrompt(profile) {
  return `You plan job searches for a candidate. Build a search plan that finds MANY relevant, currently open jobs.

${profileBrief(profile)}

Return JSON:
{"job_queries":[{"q":"","why":""}],"company_queries":[{"q":"","why":""}]}

Rules:
- 24 job_queries, each 2-7 words. Bias toward OFFICIAL employer postings, not job boards. Mix: exact target titles + "careers"; company-name + role ("Flipkart supply chain careers"); ATS-oriented ("Workday procurement analyst India"); skill-led ("SAP Ariba procurement jobs"); industry ("quick commerce supply chain jobs"); seniority for ~${profile.experience_years || 0} years. Include the city in about half. Prefer wording that surfaces recent openings ("hiring now", "careers 2026"). Avoid queries that only return Naukri/Indeed/Apna/LinkedIn mirrors.
- 8 company_queries that discover employers likely to hire this person in these cities (industries, company types, well-known employers), e.g. "quick commerce companies Bengaluru careers", "FMCG companies with procurement teams Bengaluru".
- No duplicates or near-duplicates. "why" is one short phrase.`;
}

function mintPrompt(profile, avoid) {
  return `Invent NEW Google search queries for this candidate. Be creative — different phrasings, adjacent titles, industries, tools, and employer types than the avoided list.

${profileBrief(profile)}

Do NOT repeat or lightly rephrase any of these already-used queries:
${avoid.slice(0, 40).map((q) => `- ${q}`).join("\n") || "- (none yet)"}

Return JSON:
{"job_queries":[{"q":"","why":""}],"company_queries":[{"q":"","why":""}]}

Rules:
- Exactly 10 fresh job_queries (2-8 words) and 4 company_queries.
- Bias to company careers / ATS results; include "careers" or employer names often; avoid job-board-only queries.
- Aim at roles that are hiring NOW. Vary seniority, skills, and cities from the profile.
- "why" is one short phrase.`;
}

async function upsertPlanItems(userId, plan, origin = "plan") {
  let added = 0;
  for (const [kind, items] of [
    ["jobs", plan.jobs],
    ["companies", plan.companies],
  ]) {
    for (const item of items) {
      const res = await SearchQuery.updateOne(
        { user_id: userId, kind, key: item.key },
        { $setOnInsert: { text: item.text, why: item.why, origin }, $set: { retired: false } },
        { upsert: true }
      );
      if (res.upsertedCount) added++;
    }
  }
  return added;
}

/** Regenerates the AI search plan when the profile changed or productive queries ran out. */
async function ensurePlan({ ai, profile, userId, log }) {
  const hash = planHash(profile);
  const active = await SearchQuery.countDocuments({ user_id: userId, kind: "jobs", retired: false });
  if (profile.plan_hash === hash && active >= MIN_ACTIVE_JOB_QUERIES) return { planned: 0 };

  const plan = normalizePlan(await ai.json(planPrompt(profile), { maxTokens: 2500, label: "Planning search keywords", reserve: 0.15 }));
  const added = await upsertPlanItems(userId, plan, "plan");
  await Profile.updateOne({ _id: profile._id }, { $set: { plan_hash: hash, plan_generated_at: new Date() } });
  profile.plan_hash = hash;
  await log.info(`Search plan ready: ${plan.jobs.length} job keywords and ${plan.companies.length} company searches (${added} new)`);
  return { planned: added };
}

/** Each crawl invents new profile-based keywords so searches do not recycle the same phrases. */
async function mintFreshQueries({ ai, profile, userId, log, jobCount = 10, companyCount = 4 }) {
  const existing = await SearchQuery.find({ user_id: userId, retired: false }, "text kind").lean();
  const avoid = existing.map((q) => q.text);
  const minted = normalizePlan(await ai.json(mintPrompt(profile, avoid), { maxTokens: 1200, label: "Minting fresh search keywords", reserve: 0.12 }));
  minted.jobs = minted.jobs.slice(0, jobCount);
  minted.companies = minted.companies.slice(0, companyCount);
  const added = await upsertPlanItems(userId, minted, "mint");
  if (added) await log.info(`Invented ${added} new search keywords from your profile`);
  return { added, jobs: minted.jobs, companies: minted.companies };
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

module.exports = {
  planHash,
  queryKey,
  rankQueries,
  queryScore,
  shouldRetire,
  normalizePlan,
  planPrompt,
  mintPrompt,
  ensurePlan,
  mintFreshQueries,
  pickQueries,
  recordYield,
};
