const { JobPosting, Profile, JOB_SOURCES } = require("@jobportal/db");
const { syncUserSheet } = require("@jobportal/google");
const { searchWeb, crawlCareerPages } = require("../crawl/discovery");
const { ensurePlan, pickQueries, recordYield, queryKey } = require("../crawl/planner");
const { discoverCompanies, findCareersPage, normalizeCompanies, registrableDomain } = require("../crawl/companies");
const { detectBoard, detectBoardFromHtml } = require("../crawl/career-boards");
const { enrichJobs } = require("../crawl/enrich");
const { recordVisit } = require("../crawl/memory");
const { scoreJobs } = require("../crawl/score");
const { normalizeUrl, dedupeKey, isBlocked, matchesLocation, postedAgeDays, slug } = require("../crawl/normalize");
const {
  companiesFromAggregatorJobs,
  preferGenuineJobs,
  isAggregatorUrl,
  isGenuineUrl,
} = require("../crawl/sources");
const { getBrowser } = require("../browser");
const { contextOptions } = require("@jobportal/portals");
const { withAi, loadResumeAndProfile } = require("./shared");

const MAX_SCORE_PER_RUN = 60;
const RESCORE_WINDOW_DAYS = 7;
const GOOD_MATCH = 70;
const DISCOVERY_EVERY_MS = 24 * 3600 * 1000;
const COMPANIES_PER_DISCOVERY = 12;
const AGGREGATOR_COMPANIES_PER_RUN = 8;

/** Normalises one discovered posting, or returns `{ skip: reason }` when it fails the user's filters. */
function toRecord(raw, { profile, maxAgeDays, dropAggregators = false }) {
  const title = String(raw.title || "").trim();
  const company = String(raw.company || "").trim();
  const url = normalizeUrl(raw.apply_url || raw.job_url || raw.url);
  if (!title || !company || !url) return { skip: "missing details" };
  if (dropAggregators && isAggregatorUrl(url) && !isGenuineUrl(url)) return { skip: "job board mirror" };
  if (isBlocked(company, profile.exclude_companies)) return { skip: "excluded company" };
  if (!matchesLocation(raw.location, profile.target_locations, profile.remote_ok)) return { skip: "location" };
  const age = postedAgeDays(raw.posted);
  if (age !== null && age > maxAgeDays) return { skip: "too old" };
  let source = JOB_SOURCES.includes(raw.source) ? raw.source : "web";
  // Employer careers / ATS links found via web search should not stay labeled as generic "web".
  if (source === "web" && isGenuineUrl(url)) source = "career_page";
  return {
    source,
    source_site: String(raw.source_site || "").slice(0, 80),
    job_url: url,
    title: title.slice(0, 200),
    company: company.slice(0, 120),
    location: String(raw.location || "").slice(0, 160),
    posted_text: String(raw.posted || "").slice(0, 80),
    age_days: age,
    experience: String(raw.experience || "").slice(0, 80),
    description: String(raw.description || "").slice(0, 6000),
    dedupe_key: dedupeKey(company, title),
    search_query: raw.found_by ? String(raw.found_by).slice(0, 120) : undefined,
  };
}

/** Turns aggregator hits (Apna/Naukri/…) into target companies so we crawl their real careers pages. */
async function harvestCompaniesFromAggregators({ jobs, profile, userId, log, browser, ai }) {
  const harvested = companiesFromAggregatorJobs(jobs).slice(0, AGGREGATOR_COMPANIES_PER_RUN);
  if (!harvested.length) return 0;

  const knownNames = new Set((profile.career_pages || []).map((p) => slug(p.name)));
  const knownDomains = new Set((profile.career_pages || []).map((p) => registrableDomain(p.url)).filter(Boolean));
  let candidates = harvested.filter((c) => !knownNames.has(slug(c.name)));
  if (!candidates.length) return 0;

  const needSearch = candidates.filter((c) => !c.website && !c.url);
  if (needSearch.length && ai) {
    const queries = needSearch.slice(0, 4).map((c) => `${c.name} official careers page`);
    const found = await discoverCompanies({ ai, profile, queries, max: needSearch.length, log }).catch(() => []);
    const byName = new Map(found.map((c) => [slug(c.name), c]));
    candidates = candidates.map((c) => {
      const hit = byName.get(slug(c.name));
      return hit ? { ...c, website: hit.website || c.website, url: hit.url || c.url } : c;
    });
  }

  candidates = normalizeCompanies(candidates, { knownDomains, knownNames }).slice(0, AGGREGATOR_COMPANIES_PER_RUN);
  if (!candidates.length) {
    await log.info(`Job boards mentioned ${harvested.length} employers already on your company list`);
    return 0;
  }

  const context = await browser.newContext(contextOptions({ mobile: false }));
  try {
    const added = await addVerifiedCompanies({ candidates, profile, userId, log, context });
    if (added) await log.info(`Followed job-board mentions to ${added} official careers page${added === 1 ? "" : "s"}`);
    return added;
  } finally {
    await context.close().catch(() => {});
  }
}

/** Stores records that are not already known (by URL or company+title); returns the created records. */
async function storeNewJobs(records, { userId, runId, log }) {
  const unique = [];
  const urls = new Set();
  const keys = new Set();
  for (const r of records) {
    if (urls.has(r.job_url) || keys.has(r.dedupe_key)) continue;
    urls.add(r.job_url);
    keys.add(r.dedupe_key);
    unique.push(r);
  }
  const existing = await JobPosting.find(
    { user_id: userId, $or: [{ job_url: { $in: [...urls] } }, { dedupe_key: { $in: [...keys] } }] },
    "job_url dedupe_key"
  ).lean();
  const knownUrls = new Set(existing.map((j) => j.job_url));
  const knownKeys = new Set(existing.map((j) => j.dedupe_key));

  const created = [];
  for (const r of unique) {
    if (knownUrls.has(r.job_url) || knownKeys.has(r.dedupe_key)) continue;
    try {
      await JobPosting.create({ ...r, user_id: userId, run_id: runId, first_seen_at: new Date() });
      created.push(r);
      if (log) await log.job(`New job: ${r.title} at ${r.company}${r.source_site ? ` · ${r.source_site}` : ""}`);
    } catch (err) {
      if (err.code !== 11000) throw err;
    }
  }
  return created;
}

async function step(log, label, fn) {
  try {
    return await fn();
  } catch (err) {
    if (["AiKeyError", "RunCancelled"].includes(err.name)) throw err;
    if (err.name === "BudgetExceededError") await log.warn(err.message);
    else await log.warn(`${label} failed: ${err.message}`);
    return null;
  }
}

/** Persists discovered companies and per-page crawl stats (also when a run is cancelled mid-crawl). */
async function saveCareerPages(profile) {
  await Profile.updateOne(
    { _id: profile._id },
    {
      $set: {
        career_pages: profile.career_pages.map((p) => (p.toObject ? p.toObject() : p)),
        last_company_discovery_at: profile.last_company_discovery_at,
      },
    }
  );
}

async function addVerifiedCompanies({ candidates, profile, userId, log, context }) {
  let added = 0;
  for (const c of candidates) {
    const check = await findCareersPage(c, { context });
    await recordVisit(userId, check.finalUrl, { kind: "careers", status: check.ok ? "ok" : check.status === 404 ? "not_found" : "error", note: c.name });
    if (!check.ok) {
      await log.info(`Skipped ${c.name}: no careers page found (${check.error || `HTTP ${check.status}`})`);
      continue;
    }
    const board = detectBoard(check.finalUrl).type !== "generic" ? detectBoard(check.finalUrl) : detectBoardFromHtml(check.html);
    profile.career_pages.push({
      name: c.name,
      url: check.finalUrl,
      enabled: true,
      source: "ai",
      reason: c.why,
      ats: board?.type || "website",
      discovered_at: new Date(),
    });
    added++;
    await log.info(`Added company: ${c.name} (${board?.type || "website"})${c.why ? ` · ${c.why}` : ""}`);
  }
  return added;
}

/** Finds new companies (daily), verifies their careers pages and adds them to the user's target companies. */
async function discoverAndAddCompanies({ ai, profile, settings, userId, log, browser }) {
  const aiCount = (profile.career_pages || []).filter((p) => p.source === "ai").length;
  const due = !profile.last_company_discovery_at || Date.now() - new Date(profile.last_company_discovery_at) > DISCOVERY_EVERY_MS;
  if (!settings.discover_companies || !due || aiCount >= settings.max_companies) return 0;

  const queries = await pickQueries(userId, "companies", 3);
  const texts = queries.length
    ? queries.map((q) => q.text)
    : [`companies hiring ${(profile.target_roles || [])[0] || "operations"} ${(profile.target_locations || [])[0] || ""}`.trim()];
  const max = Math.min(COMPANIES_PER_DISCOVERY, settings.max_companies - aiCount);
  const candidates = await discoverCompanies({ ai, profile, queries: texts, max, log });

  let added = 0;
  if (candidates.length) {
    const context = await browser.newContext(contextOptions({ mobile: false }));
    try {
      added = await addVerifiedCompanies({ candidates, profile, userId, log, context });
    } finally {
      await context.close().catch(() => {});
    }
  }
  profile.last_company_discovery_at = new Date();
  await recordYield(queries, new Map(queries.map((q) => [q.key, { results: candidates.length, new_jobs: added }])));
  return added;
}

async function crawlTask(ctx) {
  const { user, run, log, stage, count, checkCancel } = ctx;
  const { resume, profile } = await loadResumeAndProfile(user);
  if (!profile?.target_roles?.length) throw new Error("Add at least one target role to your profile first.");
  const settings = user.crawler;

  return withAi({ user, log, run }, async (ai, budget) => {
    await log.info(
      `Searching for ${profile.target_roles.length} roles in ${profile.target_locations.join(", ") || "any location"} with ${ai.provider} · AI budget ${budget.budget ? `${budget.used.toLocaleString("en-US")} of ${budget.budget.toLocaleString("en-US")} tokens used today` : "unlimited"}`
    );

    await stage("plan", "Planning search keywords");
    await step(log, "Planning", () => ensurePlan({ ai, profile, userId: user._id, log }));
    const jobQueries = await pickQueries(user._id, "jobs", settings.searches_per_run * 3);
    await checkCancel();

    const raw = [];
    let browser = null;
    if (settings.web_search) {
      await stage("search", "Searching the web");
      const found = await step(log, "Web search", () =>
        searchWeb({ ai, profile, settings, log, queries: jobQueries, rotation: Math.floor(Date.now() / 3600000) })
      );
      if (found) {
        await stage("read", "Reading job pages");
        const records = found
          .map((r) => ({ ...r, job_url: normalizeUrl(r.apply_url || r.url) }))
          .filter((r) => (r.job_url || r.company) && !isBlocked(r.company, profile.exclude_companies));
        const withUrls = records.filter((r) => r.job_url);
        const { alive } = await enrichJobs(withUrls, { userId: user._id, log });
        // Keep company-only hints (no URL) so we can still open their careers pages.
        raw.push(...alive, ...records.filter((r) => !r.job_url && r.company));
      }
    }
    await checkCancel();

    if (settings.career_pages) {
      browser = await getBrowser();
      await stage("discover", "Finding companies and career pages");
      await step(log, "Company discovery", () => discoverAndAddCompanies({ ai, profile, settings, userId: user._id, log, browser }));
      await step(log, "Follow job-board companies", () =>
        harvestCompaniesFromAggregators({ jobs: raw, profile, userId: user._id, log, browser, ai })
      );
      await saveCareerPages(profile);
      await stage("careers", "Crawling company career pages");
      try {
        const careers = await step(log, "Career pages", () =>
          crawlCareerPages({ ai, profile, log, userId: user._id, browser, limit: settings.career_pages_per_run, budget, checkCancel })
        );
        if (careers) raw.push(...careers);
      } finally {
        await saveCareerPages(profile);
      }
    }

    const preferred = preferGenuineJobs(raw.filter((r) => r.job_url || r.apply_url || r.url));
    const result = await ingestJobs({
      ai,
      raw: preferred,
      user,
      profile,
      resume,
      run,
      log,
      stage,
      count,
      checkCancel,
      dropAggregators: Boolean(settings.career_pages),
    });

    const stats = new Map(jobQueries.map((q) => [q.key, { results: 0, new_jobs: 0, good_matches: 0 }]));
    for (const r of raw) if (r.found_by && stats.has(r.found_by)) stats.get(r.found_by).results++;
    const perQuery = await JobPosting.aggregate([
      { $match: { run_id: run._id, search_query: { $in: [...stats.keys()] } } },
      { $group: { _id: "$search_query", created: { $sum: 1 }, good: { $sum: { $cond: [{ $gte: ["$match.score", GOOD_MATCH] }, 1, 0] } } } },
    ]);
    for (const row of perQuery) Object.assign(stats.get(row._id), { new_jobs: row.created, good_matches: row.good });
    await recordYield(jobQueries, stats);
    return result;
  });
}

/** Filters, de-duplicates, stores and scores discovered postings, then syncs the sheet. Shared by all crawl kinds. */
async function ingestJobs({ ai, raw, user, profile, resume, run, log, stage, count, checkCancel, dropAggregators = false }) {
  const settings = user.crawler;
  const records = [];
  const skipped = {};
  for (const r of raw) {
    const rec = toRecord(r, { profile, maxAgeDays: settings.max_job_age_days, dropAggregators });
    if (rec.skip) skipped[rec.skip] = (skipped[rec.skip] || 0) + 1;
    else records.push(rec);
  }
  const created = await storeNewJobs(records, { userId: user._id, runId: run._id, log });
  await count({ found: raw.length, matched_filters: records.length, new: created.length });
  const skipText = Object.entries(skipped).map(([reason, n]) => `${n} ${reason}`).join(", ");
  await log.info(
    `Found ${raw.length} postings, ${records.length} passed your filters${skipText ? ` (skipped: ${skipText})` : ""}, ${created.length} are new`
  );
  await checkCancel();

  await stage("score", "Scoring jobs against your resume");
  const toScore = await JobPosting.find({
    user_id: user._id,
    "match.scored_at": null,
    first_seen_at: { $gte: new Date(Date.now() - RESCORE_WINDOW_DAYS * 86400000) },
  })
    .sort({ first_seen_at: -1 })
    .limit(MAX_SCORE_PER_RUN);
  const scored =
    (await step(log, "Scoring", () => scoreJobs({ ai, jobs: toScore, resumeText: resume.text, profile, log, checkCancel }))) ?? 0;
  if (scored < toScore.length) await log.info(`${toScore.length - scored} jobs will be scored in a later run`);
  const relevant = await JobPosting.countDocuments({ run_id: run._id, "match.score": { $gte: settings.min_match_to_sheet } });
  await count({ scored, relevant });
  await log.info(`Scored ${scored} jobs; ${relevant} new jobs match ${settings.min_match_to_sheet}%+`);

  if (user.google?.refresh_token) {
    await stage("sync", "Updating your Google Sheet");
    try {
      const sync = await syncUserSheet(user);
      await log.info(`Google Sheet updated with ${sync.rows} jobs`);
    } catch (err) {
      await log.warn(`Google Sheet sync failed: ${err.message}`);
    }
  }
  return { found: raw.length, new: created.length, scored, relevant };
}

module.exports = { crawlTask, ingestJobs, toRecord, storeNewJobs, queryKey };
