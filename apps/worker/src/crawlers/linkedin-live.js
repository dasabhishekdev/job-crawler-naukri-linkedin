const fs = require("fs");
const { Job } = require("@jobportal/db");
const { getJobKeywords } = require("@jobportal/core");
const { delay, withRetry } = require("../utils");
const {
  incrementCrawlProgress,
  shouldStopCrawl,
  updateCrawlProgress,
  pushQueryUsed,
} = require("../progress");
const { createPlanner } = require("@jobportal/core");
const {
  textFromLocator,
  expandLinkedInDescription,
  parseExperienceLevel,
  splitCompanyLocation,
} = require("./extract-helpers");
const { enrichJobRecord, buildRawListingRecord, isFreshOpen } = require("./job-record");

class SessionExpiredError extends Error {
  constructor() {
    super("LinkedIn session expired. Open Browser Login and save session.");
    this.name = "SessionExpiredError";
  }
}

function buildJobSearchUrl(keywords, location, start = 0) {
  const params = new URLSearchParams({
    keywords,
    location,
    origin: "JOB_SEARCH_PAGE_SEARCH_BUTTON",
  });
  if (start > 0) params.set("start", String(start));
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

function parseJobId(url) {
  const match = (url || "").match(/\/jobs\/view\/(\d+)/);
  return match ? match[1] : null;
}

function isSearchResultsUrl(url) {
  return (url || "").includes("/jobs/search");
}

async function gotoWithRetry(page, url, log, label) {
  return withRetry(
    async () => {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 90000,
      });
      if (page.url().includes("/login") || page.url().includes("/authwall")) {
        throw new SessionExpiredError();
      }
      if (response && response.status() >= 400) {
        throw new Error(`HTTP ${response.status()}`);
      }
      await page.bringToFront().catch(() => {});
    },
    {
      retries: 3,
      delayMs: 3000,
      onRetry: async (attempt, err) => {
        if (log) await log.warn(`${label} retry ${attempt}: ${err.message}`);
      },
    }
  );
}

async function ensureOnSearchPage(page, searchUrl, log) {
  if (isSearchResultsUrl(page.url())) return;
  await gotoWithRetry(page, searchUrl, log, "Return to LinkedIn search results");
  await delay(1500);
  await page
    .waitForSelector(
      ".jobs-search-results__list-item, [data-occludable-job-id], .jobs-search-results-list",
      { timeout: 15000 }
    )
    .catch(() => {});
}

async function extractJobCards(page) {
  return page.evaluate(() => {
    const seen = new Set();
    const results = [];

    const firstText = (root, selectors) => {
      for (const sel of selectors) {
        const el = root.querySelector(sel);
        const text = el?.innerText?.trim() || el?.textContent?.trim();
        if (text) return text;
      }
      return null;
    };

    const cards = document.querySelectorAll(
      ".jobs-search-results__list-item, li.jobs-search-results__list-item, [data-occludable-job-id], .job-card-container"
    );

    for (const card of cards) {
      const link = card.querySelector('a[href*="/jobs/view/"]');
      const href = link?.href || link?.getAttribute("href");
      if (!href) continue;

      const job_url = (href.startsWith("http") ? href : `https://www.linkedin.com${href}`).split(
        "?",
        1
      )[0];
      if (seen.has(job_url)) continue;
      seen.add(job_url);

      const job_title = firstText(card, [
        ".job-card-list__title",
        ".job-card-container__link strong",
        "a.job-card-container__link",
        "[data-test-job-card-title]",
        "h3",
        "strong",
      ]);

      let company = firstText(card, [
        "[data-test-job-card-company-name]",
        ".job-card-container__company-name",
        ".artdeco-entity-lockup__subtitle span",
        ".artdeco-entity-lockup__subtitle",
        ".job-card-container__primary-description span",
        ".job-card-container__primary-description",
        ".job-card-list__company-name",
      ]);

      let location = firstText(card, [
        "[data-test-job-card-location]",
        ".job-card-container__metadata-item",
        ".artdeco-entity-lockup__caption",
        ".job-card-container__metadata-wrapper",
      ]);

      const primary = firstText(card, [".job-card-container__primary-description"]);
      if (primary && !company) {
        const bits = primary.split(/[·•]/).map((s) => s.trim()).filter(Boolean);
        if (bits.length >= 1) company = bits[0];
        if (bits.length >= 2 && !location) location = bits.slice(1).join(", ");
      }

      const posted =
        firstText(card, ["time", ".job-card-container__footer-item"]) ||
        card.querySelector("time")?.getAttribute("datetime");

      results.push({
        job_title,
        company,
        location,
        posted,
        job_url,
        job_id: job_url.match(/\/jobs\/view\/(\d+)/)?.[1] || null,
      });
    }
    return results;
  });
}

async function clickJobCardOnSearchPage(page, listing) {
  const jobId = listing.job_id || parseJobId(listing.job_url);
  if (!jobId) return false;

  const selectors = [
    `a[href*="/jobs/view/${jobId}"]`,
    `[data-occludable-job-id="${jobId}"] a[href*="/jobs/view/"]`,
    `.jobs-search-results__list-item:has(a[href*="${jobId}"]) a[href*="/jobs/view/"]`,
  ];

  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
      await loc.scrollIntoViewIfNeeded().catch(() => {});
      await loc.click({ timeout: 8000 });
      await delay(1200);
      return true;
    }
  }
  return false;
}

async function extractJobDetails(page) {
  await expandLinkedInDescription(page);

  const job_title = await textFromLocator(page, [
    ".job-details-jobs-unified-top-card__job-title",
    "h1.t-24",
    "h1.job-details-jobs-unified-top-card__job-title",
    "h1",
  ]);

  let company = await textFromLocator(page, [
    ".job-details-jobs-unified-top-card__company-name a",
    ".job-details-jobs-unified-top-card__company-name",
    ".job-details-jobs-unified-top-card__primary-description a",
    'a[data-test-app-aware-link][href*="/company/"]',
    ".jobs-unified-top-card__company-name",
  ]);

  let location = await textFromLocator(page, [
    ".job-details-jobs-unified-top-card__bullet",
    ".job-details-jobs-unified-top-card__primary-description-container span",
    ".jobs-unified-top-card__bullet",
    ".job-details-jobs-unified-top-card__tertiary-description-container",
  ]);

  const posted = await textFromLocator(page, [
    ".jobs-unified-top-card__posted-date",
    "span.tvm__text--low-emphasis",
    ".job-details-jobs-unified-top-card__posted-date",
  ]);

  const employment_type = await textFromLocator(page, [
    ".job-details-jobs-unified-top-card__job-insight span",
    ".job-details-fit-level-preferences button",
    'li[class*="job-insight"] span',
  ]);

  const experience_hint = await textFromLocator(page, [
    ".job-details-jobs-unified-top-card__job-insight:nth-child(2) span",
    'li[class*="job-insight"]:nth-child(2) span',
    'span[class*="experience"]',
  ]);

  let description = null;
  const descLocator = page
    .locator(
      ".jobs-description__content, #job-details, .jobs-box__html-content, .jobs-description-content__text"
    )
    .first();
  if (await descLocator.isVisible({ timeout: 1000 }).catch(() => false)) {
    description = await descLocator.innerText().catch(() => null);
  }

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const lower = bodyText.toLowerCase();
  const closed =
    lower.includes("no longer accepting applications") ||
    lower.includes("no longer accepting applicants");
  const dead =
    lower.includes("job no longer available") ||
    lower.includes("this job is no longer available");

  const easyApply = await page
    .locator('button[aria-label*="Easy Apply"], button.jobs-apply-button')
    .first()
    .isVisible({ timeout: 400 })
    .catch(() => false);

  const externalLink = await page
    .locator('a.jobs-apply-button, a[data-control-name="jobdetails_topcard_inapply"]')
    .first()
    .getAttribute("href")
    .catch(() => null);

  let apply_type = "unknown";
  if (easyApply) apply_type = "easy_apply";
  else if (externalLink && !externalLink.includes("linkedin.com/jobs")) {
    apply_type = "external";
  }

  const experience_level = parseExperienceLevel(
    experience_hint,
    employment_type,
    description?.slice(0, 800)
  );

  if (!company) {
    const primary = await textFromLocator(page, [
      ".job-details-jobs-unified-top-card__primary-description",
    ]);
    const split = splitCompanyLocation(primary);
    company = split.company || company;
    if (!location) location = split.location;
  }

  return {
    job_title,
    company,
    location,
    posted,
    description: description?.trim() || null,
    employment_type,
    experience_level,
    closed,
    dead,
    apply_type,
  };
}

async function scrapeListingOnSearchPage(page, listing, profile, config, searchUrl, log) {
  await ensureOnSearchPage(page, searchUrl, log);

  if (page.url().includes("/login") || page.url().includes("/authwall")) {
    throw new SessionExpiredError();
  }

  const clicked = await clickJobCardOnSearchPage(page, listing);

  if (clicked) {
    await page
      .waitForSelector(
        ".job-details-jobs-unified-top-card__job-title, .jobs-search__job-details, h1.t-24, .jobs-description__content",
        { timeout: 12000 }
      )
      .catch(() => {});
    const detail = await extractJobDetails(page);
    return enrichJobRecord(listing, detail, profile, config);
  }

  // Fallback: open job URL then return to search results
  await gotoWithRetry(page, listing.job_url, log, `LinkedIn job ${listing.job_id}`);
  await delay(config.validateDelayMs || 1500);
  await page
    .waitForSelector(
      ".job-details-jobs-unified-top-card__job-title, h1.t-24, .jobs-description__content",
      { timeout: 15000 }
    )
    .catch(() => {});

  if (page.url().includes("/login") || page.url().includes("/authwall")) {
    throw new SessionExpiredError();
  }

  const detail = await extractJobDetails(page);
  const enriched = enrichJobRecord(listing, detail, profile, config);

  if (searchUrl) {
    const returned = await page
      .goBack({ waitUntil: "domcontentloaded", timeout: 30000 })
      .then(() => isSearchResultsUrl(page.url()))
      .catch(() => false);

    if (!returned) {
      await gotoWithRetry(page, searchUrl, log, "Return to search after job detail");
    }
    await delay(1000);
  }

  return enriched;
}

async function saveJob(job, runId) {
  const doc = {
    source: "linkedin",
    job_url: job.job_url,
    job_id: job.job_id || parseJobId(job.job_url),
    job_title: job.job_title,
    company: job.company,
    location: job.location,
    posted: job.posted,
    posted_text: job.posted_text,
    age_days: job.age_days,
    freshness: job.freshness || "unknown",
    description: job.description,
    employment_type: job.employment_type,
    experience_level: job.experience_level,
    search_keyword: job.search_keyword,
    match_score: job.match_score || 0,
    match_reasons: job.match_reasons || [],
    tier: job.tier,
    url_status: job.url_status || "discovered",
    apply_type: job.apply_type || "unknown",
    validated_at: job.validated_at || new Date(),
    crawl_run_id: runId,
    scraped_at: new Date(),
    application_status: "not_eligible",
  };

  return Job.findOneAndUpdate(
    { source: "linkedin", job_url: job.job_url },
    { $set: doc },
    { upsert: true, new: true }
  );
}

async function persistListing(page, listing, profile, config, runId, searchUrl, log, stats) {
  let record;
  try {
    record = await scrapeListingOnSearchPage(
      page,
      listing,
      profile,
      config,
      searchUrl,
      log
    );
    stats.validated += 1;
  } catch (err) {
    if (err instanceof SessionExpiredError) throw err;
    record = buildRawListingRecord(listing, profile, config, err.message);
    if (log) await log.warn(`LinkedIn partial save: ${listing.job_url} — ${err.message}`);
    if (searchUrl) await ensureOnSearchPage(page, searchUrl, log).catch(() => {});
  }

  if (record.freshness === "stale") stats.stale += 1;
  if (record.url_status === "dead") stats.dead += 1;
  if (record.url_status === "valid_open") stats.valid_open += 1;

  const fresh = isFreshOpen(record);
  await saveJob(record, runId);
  stats.synced += 1;

  await incrementCrawlProgress(runId, {
    discovered: 1,
    validated: 1,
    linkedin_fetched: 1,
    valid_open: record.url_status === "valid_open" ? 1 : 0,
    fresh_found: fresh ? 1 : 0,
    stale: record.freshness === "stale" ? 1 : 0,
    dead: record.url_status === "dead" ? 1 : 0,
  });

  return { record, fresh };
}

async function runLinkedInLiveCrawl({ browser, profile, config, runId, log }) {
  const storagePath =
    process.env.LINKEDIN_STORAGE_STATE || "/app/jobhunter/storageState.json";

  if (!fs.existsSync(storagePath)) {
    await log.warn(`LinkedIn session not found at ${storagePath} — skipping live crawl`);
    return { discovered: 0, validated: 0, valid_open: 0, stale: 0, dead: 0, synced: 0 };
  }

  const location =
    process.env.LINKEDIN_LOCATION || "Bangalore, Karnataka, India";
  const pageSize = Number(process.env.LINKEDIN_PAGE_SIZE) || 25;
  const maxPages = Number(process.env.LINKEDIN_MAX_PAGES) || 4;
  const threshold = config.freshPerKeyword ?? 8;

  const planner = createPlanner({
    resumeText: config.resumeText,
    fallbackKeywords: config.fallbackKeywordsByPlatform?.linkedin || getJobKeywords(profile),
    location,
    log,
    queryQueue: config.queryQueueByPlatform?.linkedin || [],
    platform: "linkedin",
    allowTopUp: config.allowKeywordTopUp !== false,
    querySourceLabel: config.keywordSourceLabel || "ai",
  });

  const context = await browser.newContext({
    storageState: storagePath,
    viewport: { width: 1280, height: 720 },
  });
  const page = await context.newPage();

  const seen = new Set();
  const stats = {
    discovered: 0,
    validated: 0,
    valid_open: 0,
    stale: 0,
    dead: 0,
    synced: 0,
  };

  try {
    await log.info(`LinkedIn scrape-only crawl (no apply) — ${location}`);

    let currentQuery = null;
    let freshFromQuery = 0;
    let listingsWithoutFresh = 0;

    while (!(await shouldStopCrawl(runId, config))) {
      if (!currentQuery || freshFromQuery >= threshold) {
        const nextResult = await planner.next();
        if (nextResult.done || !nextResult.query) {
          await log.info("LinkedIn selected queries exhausted — stopping platform crawl");
          break;
        }
        const { query, reasoning, source } = nextResult;
        currentQuery = query;
        freshFromQuery = 0;
        listingsWithoutFresh = 0;
        await updateCrawlProgress(runId, {
          linkedin_current_query: currentQuery,
          linkedin_fresh_from_query: 0,
          linkedin_keyword_source: source || "fallback",
        });
        await pushQueryUsed(runId, "linkedin", currentQuery);
        await log.info(
          `LinkedIn new query (${source || "fallback"}): "${currentQuery}"${reasoning ? ` — ${reasoning}` : ""}`,
          { keyword: currentQuery }
        );
      }

      let queryExhausted = false;

      for (let start = 0; start < maxPages * pageSize; start += pageSize) {
        if (await shouldStopCrawl(runId, config)) break;
        if (freshFromQuery >= threshold) break;
        if (listingsWithoutFresh >= 20) {
          queryExhausted = true;
          break;
        }

        const searchUrl = buildJobSearchUrl(currentQuery, location, start);
        await log.info(`LinkedIn search: "${currentQuery}" page ${start / pageSize + 1}`, {
          keyword: currentQuery,
          url: searchUrl,
        });

        try {
          await gotoWithRetry(page, searchUrl, log, `LinkedIn search "${currentQuery}"`);
          await delay(2000);
          await page
            .waitForSelector(
              ".jobs-search-results__list-item, [data-occludable-job-id], .jobs-search-results-list",
              { timeout: 15000 }
            )
            .catch(() => {});
        } catch (err) {
          if (err instanceof SessionExpiredError) throw err;
          await log.warn(`LinkedIn search failed: ${err.message}`);
          queryExhausted = true;
          break;
        }

        const cards = await extractJobCards(page);
        if (cards.length === 0) {
          queryExhausted = true;
          break;
        }

        await log.info(`LinkedIn found ${cards.length} cards for "${currentQuery}"`);

        for (const card of cards) {
          if (await shouldStopCrawl(runId, config)) break;
          if (freshFromQuery >= threshold) break;
          if (listingsWithoutFresh >= 20) break;
          if (!card.job_url || seen.has(card.job_url)) continue;
          seen.add(card.job_url);
          stats.discovered += 1;

          const listing = { ...card, search_keyword: currentQuery };
          const { record, fresh } = await persistListing(
            page,
            listing,
            profile,
            config,
            runId,
            searchUrl,
            log,
            stats
          );

          if (fresh) {
            freshFromQuery += 1;
            listingsWithoutFresh = 0;
            await updateCrawlProgress(runId, { linkedin_fresh_from_query: freshFromQuery });
            planner.recordFresh(currentQuery, freshFromQuery);
          } else {
            listingsWithoutFresh += 1;
          }

          await log.info(
            `LinkedIn ${record.freshness}/${record.url_status} | score ${record.match_score || 0} | ${record.company || "?"} — ${record.job_title || "Untitled"}`,
            { job_url: record.job_url }
          );

          await delay(config.validateDelayMs);
          await ensureOnSearchPage(page, searchUrl, log).catch(() => {});
        }

        await delay(config.searchDelayMs);
      }

      if (queryExhausted && freshFromQuery < threshold) {
        freshFromQuery = threshold;
      }
    }

    await log.info(`LinkedIn live crawl complete`, stats);
    return stats;
  } finally {
    await context.close();
  }
}

module.exports = { runLinkedInLiveCrawl, SessionExpiredError };
