const { detectBoard, fetchBoardJobs } = require("./career-boards");
const { runCursorAgent } = require("./cursor-agent");
const { extractJsonArray, isBengaluru } = require("./normalize");
const { rolesForProfile } = require("./web-search");

const GENERIC_PER_PROMPT = 4;

const GENERIC_ROLE_WORDS = new Set([
  "analyst", "executive", "manager", "specialist", "associate", "lead", "senior", "junior",
  "and", "of", "the", "for", "team", "leader", "officer", "operations", "management",
  "quick", "commerce", "line", "data", "bangalore", "bengaluru",
]);

function titleTokens(profile) {
  const tokens = new Set();
  for (const phrase of [...rolesForProfile(profile), ...(profile.job_keywords || [])]) {
    for (const word of String(phrase).toLowerCase().split(/[^a-z]+/)) {
      if (word.length > 2 && !GENERIC_ROLE_WORDS.has(word)) tokens.add(word);
    }
  }
  for (const stem of ["procure", "purchas", "sourcing", "buyer", "vendor", "logistic", "inventory", "warehouse", "fulfil", "supply"]) {
    tokens.add(stem);
  }
  return [...tokens];
}

function titleMatches(title, tokens) {
  const t = String(title || "").toLowerCase();
  return tokens.some((token) => t.includes(token));
}

function genericPrompt({ pages, profile, location, perPage }) {
  const list = pages.map((p, i) => `${i + 1}. ${p.name || "Company"} — ${p.url}`).join("\n");
  return `Open each company careers page below and list CURRENTLY OPEN roles in ${location} that fit these target roles: ${rolesForProfile(profile).join("; ")} (~${profile.experience_years || 2} years experience).
If a page needs JavaScript or shows no listings, use web search restricted to that company's careers domain or its ATS (Workday, SuccessFactors, iCIMS, etc.).
Up to ${perPage} roles per company. Skip roles that clearly do not fit.

${list}

Return ONLY a JSON array (no prose). Each item:
{"title":"","company":"","location":"","apply_url":"","source_site":"careers page domain","posted":"","experience":"","description":"key responsibilities and requirements, max 1200 characters"}`;
}

async function crawlCareerPages({ candidate, profile, location, log, perPage = 6 }) {
  const pages = (candidate.career_pages || []).filter((p) => p.enabled !== false && p.url);
  const tokens = titleTokens(profile);
  const jobs = [];
  const generic = [];

  for (const page of pages) {
    const board = detectBoard(page.url);
    if (board.type === "generic") {
      generic.push(page);
      continue;
    }
    try {
      const all = await fetchBoardJobs(board);
      const fit = all.filter((j) => isBengaluru(j.location) && titleMatches(j.title, tokens));
      jobs.push(
        ...fit.map((j) => ({
          ...j,
          company: page.name || board.token,
          source: "career_page",
          source_site: `${board.type} (${page.name || board.token})`,
        }))
      );
      page.last_found = fit.length;
      page.last_error = "";
      await log.info(`${page.name || page.url}: ${fit.length} matching of ${all.length} open roles`);
    } catch (err) {
      page.last_error = err.message;
      await log.warn(`${page.name || page.url}: ${err.message}`);
    }
    page.last_crawled_at = new Date();
  }

  const chunks = [];
  for (let i = 0; i < generic.length; i += GENERIC_PER_PROMPT) chunks.push(generic.slice(i, i + GENERIC_PER_PROMPT));
  const settled = await Promise.allSettled(
    chunks.map(async (chunk) => {
      const text = await runCursorAgent(genericPrompt({ pages: chunk, profile, location, perPage }), { log });
      return extractJsonArray(text);
    })
  );
  for (const [i, outcome] of settled.entries()) {
    const chunk = chunks[i];
    if (outcome.status === "fulfilled") {
      const found = outcome.value.map((j) => ({ ...j, source: "career_page" }));
      jobs.push(...found);
      for (const page of chunk) {
        const name = String(page.name || "").toLowerCase();
        page.last_found = found.filter((j) => String(j.company || "").toLowerCase().includes(name)).length;
        page.last_error = "";
        page.last_crawled_at = new Date();
      }
      await log.info(`Career-page agent found ${found.length} roles across ${chunk.map((p) => p.name).join(", ")}`);
    } else {
      for (const page of chunk) {
        page.last_error = outcome.reason?.message;
        page.last_crawled_at = new Date();
      }
      await log.warn(`Career-page agent failed for ${chunk.map((p) => p.name).join(", ")}: ${outcome.reason?.message}`);
    }
  }

  await candidate.save();
  return jobs;
}

module.exports = { crawlCareerPages, titleTokens, titleMatches };
