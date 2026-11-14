const { extractJsonArray } = require("@jobportal/ai");
const { detectBoard, fetchBoardJobs } = require("./career-boards");
const { matchesLocation } = require("./normalize");

const ROLES_PER_SEARCH = 3;
const GENERIC_PAGES_PER_SEARCH = 4;

const GENERIC_TITLE_WORDS = new Set([
  "analyst", "executive", "manager", "specialist", "associate", "lead", "senior", "junior", "and", "of", "the",
  "for", "team", "leader", "officer", "operations", "management", "engineer", "developer", "consultant", "intern",
  "assistant", "head", "director", "staff", "principal", "trainee", "remote", "with",
]);

function uniqueRoles(profile) {
  const seen = new Set();
  return (profile.target_roles || [])
    .map((r) => String(r || "").replace(/\s+/g, " ").trim())
    .filter((r) => r && !seen.has(r.toLowerCase()) && seen.add(r.toLowerCase()));
}

/** Rotates through target roles so consecutive runs cover different roles. */
function buildSearchBatches(profile, { searches = 3, rotation = 0 } = {}) {
  const roles = uniqueRoles(profile);
  if (!roles.length) return [];
  const total = Math.min(searches * ROLES_PER_SEARCH, roles.length);
  const start = (rotation * total) % roles.length;
  const picked = Array.from({ length: total }, (_, i) => roles[(start + i) % roles.length]);
  const batches = [];
  for (let i = 0; i < picked.length; i += ROLES_PER_SEARCH) batches.push(picked.slice(i, i + ROLES_PER_SEARCH));
  return batches;
}

function locationPhrase(profile) {
  const cities = (profile.target_locations || []).filter(Boolean);
  const base = cities.length ? cities.join(" or ") : profile.current_location || "India";
  return profile.remote_ok ? `${base} (remote roles are also fine)` : `${base} (on-site or hybrid in these cities)`;
}

const JOB_JSON_SHAPE =
  '{"title":"","company":"","location":"","apply_url":"","source_site":"","posted":"date or relative text, empty if unknown","experience":"","description":"key responsibilities and requirements, max 1200 characters"}';

function webSearchPrompt({ roles, profile, settings }) {
  return `You are a job researcher. Use web search (open pages when needed) to find up to ${settings.jobs_per_search} CURRENTLY OPEN job postings.

Candidate: ~${profile.experience_years || 0} years of experience. Key skills: ${(profile.skills || []).slice(0, 15).join(", ")}.
Target roles for this search: ${roles.join("; ")}
Location: ${locationPhrase(profile)}
Only postings from the last ${settings.max_job_age_days} days when the posting shows a date.
${profile.exclude_companies?.length ? `Exclude these companies: ${profile.exclude_companies.join(", ")}.` : ""}

Search broadly: company career pages (Workday, Greenhouse, Lever, SuccessFactors, iCIMS, custom sites), LinkedIn and Naukri public listings, Indeed, Foundit, Instahyre, iimjobs, Hirist, apna, Shine, Glassdoor, Cutshort, Wellfound.
Only include postings that match the target roles and experience level. Use the most direct apply URL (prefer the company's own posting).

Return ONLY a JSON array (no prose). Each item: ${JOB_JSON_SHAPE}`;
}

function careerPagesPrompt({ pages, profile, perPage }) {
  const list = pages.map((p, i) => `${i + 1}. ${p.name || "Company"} — ${p.url}`).join("\n");
  return `Open each company careers page below and list CURRENTLY OPEN roles in ${locationPhrase(profile)} that fit these target roles: ${uniqueRoles(profile).join("; ")} (~${profile.experience_years || 0} years experience).
If a page needs JavaScript or shows no listings, use web search restricted to that company's careers domain or its ATS.
Up to ${perPage} roles per company. Skip roles that clearly do not fit.

${list}

Return ONLY a JSON array (no prose). Each item: ${JOB_JSON_SHAPE}`;
}

function titleTokens(profile) {
  const tokens = new Set();
  for (const phrase of [...uniqueRoles(profile), ...(profile.skills || []).slice(0, 10)]) {
    for (const word of String(phrase).toLowerCase().split(/[^a-z0-9+#]+/)) {
      if (word.length > 2 && !GENERIC_TITLE_WORDS.has(word)) tokens.add(word);
    }
  }
  return [...tokens];
}

function titleMatches(title, tokens) {
  const t = String(title || "").toLowerCase();
  return !tokens.length || tokens.some((token) => t.includes(token));
}

async function searchWeb({ ai, profile, settings, log, rotation }) {
  const batches = buildSearchBatches(profile, { searches: settings.searches_per_run, rotation });
  const settled = await Promise.allSettled(
    batches.map(async (roles) => {
      const jobs = extractJsonArray(await ai.search(webSearchPrompt({ roles, profile, settings })));
      await log.info(`Web search found ${jobs.length} postings for ${roles.join(", ")}`);
      return jobs.map((job) => ({ ...job, source: "web" }));
    })
  );
  return collect(settled, batches.map((b) => b.join(", ")), log);
}

async function collect(settled, labels, log) {
  const jobs = [];
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "fulfilled") jobs.push(...outcome.value);
    else {
      if (outcome.reason?.name === "AiKeyError") throw outcome.reason;
      await log.warn(`Search failed (${labels[i]}): ${outcome.reason?.message}`);
    }
  }
  return jobs;
}

async function crawlCareerPages({ ai, profile, log, perPage = 6 }) {
  const pages = (profile.career_pages || []).filter((p) => p.enabled !== false && p.url);
  const tokens = titleTokens(profile);
  const jobs = [];
  const generic = [];

  for (const page of pages) {
    const board = detectBoard(page.url);
    page.last_crawled_at = new Date();
    if (board.type === "generic") {
      generic.push(page);
      continue;
    }
    try {
      const all = await fetchBoardJobs(board);
      const fit = all.filter(
        (j) => matchesLocation(j.location, profile.target_locations, profile.remote_ok) && titleMatches(j.title, tokens)
      );
      jobs.push(...fit.map((j) => ({ ...j, company: page.name || board.token, source: "career_page", source_site: `${page.name || board.token} careers` })));
      page.last_found = fit.length;
      page.last_error = "";
      await log.info(`${page.name || page.url}: ${fit.length} matching of ${all.length} open roles`);
    } catch (err) {
      page.last_error = err.message.slice(0, 200);
      await log.warn(`${page.name || page.url}: ${err.message}`);
    }
  }

  const chunks = [];
  for (let i = 0; i < generic.length; i += GENERIC_PAGES_PER_SEARCH) chunks.push(generic.slice(i, i + GENERIC_PAGES_PER_SEARCH));
  const settled = await Promise.allSettled(
    chunks.map(async (chunk) => {
      const found = extractJsonArray(await ai.search(careerPagesPrompt({ pages: chunk, profile, perPage })));
      for (const page of chunk) {
        const name = String(page.name || "").toLowerCase();
        page.last_found = found.filter((j) => String(j.company || "").toLowerCase().includes(name)).length;
        page.last_error = "";
      }
      await log.info(`Career pages ${chunk.map((p) => p.name).join(", ")}: ${found.length} roles`);
      return found.map((j) => ({ ...j, source: "career_page" }));
    })
  );
  jobs.push(...(await collect(settled, chunks.map((c) => c.map((p) => p.name).join(", ")), log)));
  return jobs;
}

module.exports = { buildSearchBatches, searchWeb, crawlCareerPages, titleTokens, titleMatches, locationPhrase };
