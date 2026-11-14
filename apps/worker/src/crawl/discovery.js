const { extractJsonArray } = require("@jobportal/ai");
const { contextOptions } = require("@jobportal/portals");
const { detectBoard, fetchBoardJobs, fetchBoardJobDetail } = require("./career-boards");
const { crawlCareerSite } = require("./career-site");
const { recordVisit } = require("./memory");
const { matchesLocation, normalizeUrl } = require("./normalize");
const { enrichJobs } = require("./enrich");
const { queryKey } = require("./planner");

const ROLES_PER_SEARCH = 3;
const SEARCH_CONCURRENCY = 3;
const RECRAWL_HOURS = 12;
const MAX_FAILURES = 5;
const MAX_AI_FALLBACKS = 2;
const BOARD_DETAILS = 8;

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

/** Rotates through target roles so consecutive runs cover different roles (fallback when there is no plan). */
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

const SEARCH_JSON_SHAPE =
  '{"title":"","company":"","location":"","apply_url":"","source_site":"","posted":"date or relative text, empty if unknown","description":"one or two sentences from the snippet"}';

/** Every extra agent turn re-sends all earlier results, so the prompt asks for exactly one search. */
function webSearchPrompt({ query, profile, settings }) {
  return `Make exactly ONE web search for: ${query}
Then answer straight away from those results. Do not refine, verify or open pages; dates, location and experience are checked separately.

Return up to ${settings.jobs_per_search} job postings that look currently open and relevant to: ${uniqueRoles(profile).slice(0, 6).join("; ")} in ${locationPhrase(profile)}.
Prefer links to the company's own careers page or ATS posting over job boards. Skip search pages and lists of many jobs.

Return ONLY a JSON array (no prose), [] if nothing fits. Each item: ${SEARCH_JSON_SHAPE}`;
}

async function inPool(items, size, fn) {
  const settled = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        settled[i] = { status: "fulfilled", value: await fn(items[i]) };
      } catch (reason) {
        settled[i] = { status: "rejected", reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return settled;
}

function careerPagePrompt({ page, profile, perPage }) {
  const host = (() => {
    try {
      return new URL(page.url).hostname.replace(/^www\./, "");
    } catch {
      return page.name;
    }
  })();
  const roles = uniqueRoles(profile).slice(0, 3).join(" OR ");
  return `Make exactly ONE web search: site:${host} ${roles} ${(profile.target_locations || [])[0] || ""}
Then answer straight away from those results; do not open pages or search again.

List up to ${perPage} individual job postings at ${page.name || host} (not search or listing pages) that fit: ${uniqueRoles(profile).join("; ")}.

Return ONLY a JSON array (no prose), [] if nothing fits. Each item: ${SEARCH_JSON_SHAPE}`;
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

async function collect(settled, labels, log) {
  const jobs = [];
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "fulfilled") jobs.push(...outcome.value);
    else {
      if (["AiKeyError", "BudgetExceededError"].includes(outcome.reason?.name)) throw outcome.reason;
      await log.warn(`Search failed (${labels[i]}): ${outcome.reason?.message}`);
    }
  }
  return jobs;
}

/**
 * Runs one small AI web search per planned query, a few at a time.
 * Each job carries `found_by` (the query key) so query yield can be tracked.
 */
async function searchWeb({ ai, profile, settings, log, queries, rotation }) {
  const texts = queries?.length
    ? queries.map((q) => q.text)
    : buildSearchBatches(profile, { searches: settings.searches_per_run, rotation })
        .flat()
        .map((r) => `${r} jobs ${(profile.target_locations || [])[0] || ""}`.trim());
  const settled = await inPool(texts, SEARCH_CONCURRENCY, async (query) => {
    const jobs = extractJsonArray(await ai.search(webSearchPrompt({ query, profile, settings }), { label: `Web search: ${query}`, reserve: 0.15 }));
    await log.info(`Web search found ${jobs.length} postings for: ${query}`);
    return jobs.map((job) => ({ ...job, source: "web", found_by: queryKey(query) }));
  });
  return collect(settled, texts, log);
}

function duePages(profile, limit) {
  const cutoff = Date.now() - RECRAWL_HOURS * 3600 * 1000;
  return (profile.career_pages || [])
    .filter((p) => p.enabled !== false && p.url && (p.failures || 0) < MAX_FAILURES)
    .filter((p) => !p.last_crawled_at || new Date(p.last_crawled_at).getTime() < cutoff)
    .sort((a, b) => new Date(a.last_crawled_at || 0) - new Date(b.last_crawled_at || 0))
    .slice(0, limit);
}

async function boardJobs({ board, page, profile, tokens, log }) {
  const terms = uniqueRoles(profile).slice(0, 2);
  const all = await fetchBoardJobs(board, { searchTerms: terms });
  const fit = all.filter((j) => matchesLocation(j.location, profile.target_locations, profile.remote_ok) && titleMatches(j.title, tokens));
  const detailed = [];
  for (const job of fit.slice(0, BOARD_DETAILS)) detailed.push(await fetchBoardJobDetail(board, job).catch(() => job));
  await log.info(`${page.name || page.url}: ${fit.length} matching of ${all.length} open roles (${board.type})`);
  return detailed.map((j) => ({ ...j, company: page.name || board.token, source: "career_page", source_site: `${page.name || board.token} careers` }));
}

/**
 * Crawls the most stale target-company career pages: known job systems through their JSON
 * APIs, other sites in the browser, AI only as a capped fallback. Updates each page's stats.
 */
async function crawlCareerPages({ ai, profile, log, userId, browser, limit = 10, budget, checkCancel }) {
  const pages = duePages(profile, limit);
  if (!pages.length) return [];
  const tokens = titleTokens(profile);
  const context = await browser.newContext(contextOptions({ mobile: false }));
  const jobs = [];
  let aiFallbacks = 0;
  try {
    for (const page of pages) {
      await checkCancel();
      let found = [];
      try {
        let board = detectBoard(page.url);
        if (board.type === "generic") {
          const site = await crawlCareerSite({ context, entry: page, tokens, userId, log });
          if (site.board) board = site.board;
          else found = site.jobs;
          if (!site.board && !found.length && aiFallbacks < MAX_AI_FALLBACKS && !budget?.exceeded()) {
            aiFallbacks++;
            const text = await ai.search(careerPagePrompt({ page, profile, perPage: 6 }), { label: `Career page (AI search): ${page.name || page.url}`, reserve: 0.15 });
            const listed = extractJsonArray(text)
              .map((j) => ({ ...j, job_url: normalizeUrl(j.apply_url || j.url), source: "career_page", source_site: `${page.name} careers` }))
              .filter((j) => j.job_url);
            found = (await enrichJobs(listed, { userId, log })).alive;
          }
          if (!site.board) await log.info(`${page.name || page.url}: ${found.length} matching jobs`);
        }
        if (board.type !== "generic") {
          page.ats = board.type;
          found = await boardJobs({ board, page, profile, tokens, log });
        }
        page.last_found = found.length;
        page.total_found = (page.total_found || 0) + found.length;
        page.failures = 0;
        page.last_error = "";
        await recordVisit(userId, page.url, { kind: board.type === "generic" ? "careers" : "api", status: "ok", jobs: found.length });
        jobs.push(...found);
      } catch (err) {
        if (["AiKeyError", "RunCancelled"].includes(err.name)) throw err;
        if (err.name === "BudgetExceededError") {
          page.last_error = "Waiting for AI budget (resets daily)";
          await log.info(`${page.name || page.url}: AI fallback skipped, daily AI budget reached; retrying next run`);
          continue;
        }
        if (err.name !== "BoardUnavailableError") page.failures = (page.failures || 0) + 1;
        page.last_error = err.message.slice(0, 200);
        await recordVisit(userId, page.url, { kind: "careers", status: err.code === "NOT_FOUND" ? "not_found" : "error", note: err.message });
        await log.warn(`${page.name || page.url}: ${err.message}`);
      }
      page.last_crawled_at = new Date();
    }
  } finally {
    await context.close().catch(() => {});
  }
  return jobs;
}

module.exports = { buildSearchBatches, searchWeb, crawlCareerPages, duePages, titleTokens, titleMatches, locationPhrase, webSearchPrompt };
