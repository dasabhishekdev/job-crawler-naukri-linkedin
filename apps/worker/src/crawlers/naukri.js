const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright");
const {
  loadProfile,
  classifyFreshness,
} = require("@jobportal/core");
const { Job } = require("@jobportal/db");
const { emitAgentEvent } = require("@jobportal/agent");
const { buildSearchUrl, parseJobId, delay, withRetry } = require("../utils");
const { incrementCrawlProgress, shouldStopCrawl, updateCrawlProgress, pushQueryUsed } = require("../progress");
const { createPlanner } = require("@jobportal/core");
const {
  textFromLocator,
  expandNaukriDescription,
  parseExperienceLevel,
} = require("./extract-helpers");
const { enrichJobRecord, buildRawListingRecord, isFreshOpen } = require("./job-record");

async function extractListings(page) {
  return page.evaluate(() => {
    const tuples = document.querySelectorAll(
      ".srp-jobtuple-wrapper, .cust-job-tuple, article.jobTuple, .list-item, .tuple"
    );
    const results = [];

    const firstText = (root, selectors) => {
      for (const sel of selectors) {
        const el = root.querySelector(sel);
        const text = el?.innerText?.trim() || el?.textContent?.trim();
        if (text) return text;
      }
      return null;
    };

    tuples.forEach((el) => {
      const titleEl =
        el.querySelector("a.title, h2 a, .jobTupleHeader a, a[title], a.jdTitle, .title-wrap a");

      const company = firstText(el, [
        ".comp-dtls-wrap a.comp-name",
        ".comp-dtls-wrap .comp-name",
        "a.comp-name",
        ".comp-name",
        "a.subTitle",
        ".jobTupleCompanyInfo",
        '[class*="company-name"]',
        ".tuple-company-name",
        ".row .comp-name",
      ]);

      const location = firstText(el, [
        ".locWdth",
        ".loc",
        ".jobTupleLoc",
        "span.locWdth",
        ".tuple-location",
        '[class*="location"]',
      ]);

      const posted = firstText(el, [
        ".job-post-day",
        ".type",
        "span.job-post-day",
        ".tuple-posted-on",
        '[class*="posted"]',
      ]);

      const experience = firstText(el, [
        ".expwdth",
        ".exp",
        "span.expwdth",
        '[class*="experience"]',
      ]);

      const job_url = titleEl?.href || null;
      if (!job_url || !job_url.includes("naukri.com")) return;

      results.push({
        job_title: titleEl?.textContent?.trim() || null,
        company,
        location,
        posted,
        experience_level: experience,
        job_url: job_url.split("?")[0],
      });
    });

    return results;
  });
}

async function extractDetail(page) {
  await expandNaukriDescription(page);

  const title = await textFromLocator(page, [
    "h1.jd-header-title",
    "h1.title",
    "h1",
  ]);

  const company = await textFromLocator(page, [
    ".jd-header-comp-name",
    "a.comp-name",
    ".comp-name",
    '[class*="company-name"]',
    ".jd-header .comp-name",
    ".hiring-comp-name",
  ]);

  const location = await textFromLocator(page, [
    ".location",
    ".loc",
    "span.loc",
    '[class*="location"]',
    ".jd-header .loc",
  ]);

  const posted = await textFromLocator(page, [
    ".jd-posted-on",
    ".job-post-day",
    '[class*="posted"]',
  ]);

  const experience_hint = await textFromLocator(page, [
    ".jd-header-exp",
    ".exp-container",
    '[class*="experience"]',
    ".jd-header .exp",
  ]);

  let description = null;
  const descLocator = page
    .locator(
      ".dang-inner-html, .job-desc, #jobDescriptionText, .styles_jd__desc__content__"
    )
    .first();
  if (await descLocator.isVisible({ timeout: 1000 }).catch(() => false)) {
    description = await descLocator.innerText().catch(() => null);
  }

  const applyBtn = await page
    .locator('#apply-button, button.apply-button, a#apply-button, [class*="apply-button"]')
    .first()
    .isVisible({ timeout: 400 })
    .catch(() => false);

  const externalLink = await page
    .locator('a[href*="company"], a.apply-button-apply, a[title*="Apply"]')
    .first()
    .getAttribute("href")
    .catch(() => null);

  const bodyText = (await page.locator("body").innerText().catch(() => "")).toLowerCase();
  const closed =
    bodyText.includes("no longer available") ||
    bodyText.includes("job has expired") ||
    bodyText.includes("this job is closed");

  const experience_level = parseExperienceLevel(
    experience_hint,
    description?.slice(0, 800)
  );

  return {
    job_title: title,
    company,
    location,
    posted,
    description: description?.trim() || null,
    experience_level,
    has_apply: Boolean(applyBtn),
    apply_type: applyBtn ? "naukri" : externalLink ? "external" : "unknown",
    external_apply_url: externalLink || null,
    closed,
  };
}

async function validateExternalUrl(url) {
  if (!url) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JobPortal/1.0)" },
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

async function gotoWithRetry(page, url, log, label) {
  return withRetry(
    () => page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 }),
    {
      retries: 3,
      delayMs: 2500,
      onRetry: async (attempt, err) => {
        if (log) await log.warn(`${label} retry ${attempt}: ${err.message}`);
      },
    }
  );
}

async function discoverKeyword(page, keyword, config, log) {
  const url = buildSearchUrl(keyword, config.location, config.experience);
  if (log) await log.info(`Naukri search URL: ${url}`, { keyword, url });
  await gotoWithRetry(page, url, log, `Search "${keyword}"`);
  await delay(2000);

  await page
    .waitForSelector(".srp-jobtuple-wrapper, .cust-job-tuple, article.jobTuple", {
      timeout: 15000,
    })
    .catch(() => {});

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2)).catch(() => {});
  await delay(1000);

  const listings = await extractListings(page);
  return listings.map((item) => ({
    ...item,
    search_keyword: keyword,
    job_id: parseJobId(item.job_url),
    source: "naukri",
  }));
}

async function validateJob(page, listing, profile, config) {
  const maxAgeDays = config.maxJobAgeDays;
  const listingFreshness = classifyFreshness(listing.posted, maxAgeDays);

  // Stale from search card — save without opening detail page
  if (listingFreshness.freshness === "stale") {
    return enrichJobRecord(
      listing,
      {
        posted: listing.posted,
        closed: false,
        dead: false,
      },
      profile,
      config
    );
  }

  await gotoWithRetry(page, listing.job_url, null, `Job ${listing.job_url}`);
  await delay(1500);
  await page
    .waitForSelector("h1.jd-header-title, h1.title, h1, #jobDescriptionText", {
      timeout: 15000,
    })
    .catch(() => {});

  const detail = await extractDetail(page);
  const enriched = enrichJobRecord(listing, detail, profile, config);

  if (enriched.apply_type === "external" && detail.external_apply_url) {
    const ok = await validateExternalUrl(detail.external_apply_url);
    if (!ok) enriched.url_status = "dead";
  }

  return enriched;
}

async function saveJob(job, runId, candidateId) {
  const doc = {
    source: "naukri",
    job_url: job.job_url,
    job_id: job.job_id || parseJobId(job.job_url),
    job_title: job.job_title,
    company: job.company,
    location: job.location,
    posted: job.posted,
    posted_text: job.posted_text,
    age_days: job.age_days,
    freshness: job.freshness,
    description: job.description,
    employment_type: job.employment_type,
    experience_level: job.experience_level,
    search_keyword: job.search_keyword,
    match_score: job.match_score || 0,
    match_reasons: job.match_reasons || [],
    tier: job.tier,
    url_status: job.url_status,
    apply_type: job.apply_type,
    external_apply_url: job.external_apply_url,
    validated_at: job.validated_at,
    candidate_id: candidateId,
    crawl_run_id: runId,
    scraped_at: new Date(),
  };

  return Job.findOneAndUpdate(
    { source: "naukri", job_url: job.job_url, candidate_id: candidateId },
    { $set: doc },
    { upsert: true, new: true }
  );
}

async function runNaukriCrawl({ browser, profile, config, runId, log }) {
  const contextOptions = {};
  if (fs.existsSync(config.storageStatePath)) {
    contextOptions.storageState = config.storageStatePath;
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  const seen = new Set();
  const stats = {
    discovered: 0,
    validated: 0,
    valid_open: 0,
    stale: 0,
    dead: 0,
  };

  try {
    const threshold = config.freshPerKeyword ?? 8;
    const planner = createPlanner({
      resumeText: config.resumeText,
      fallbackKeywords: config.fallbackKeywordsByPlatform?.naukri || config.keywords,
      location: config.location,
      log,
      queryQueue: config.queryQueueByPlatform?.naukri || [],
      platform: "naukri",
      allowTopUp: config.allowKeywordTopUp !== false,
      querySourceLabel: config.keywordSourceLabel || "ai",
    });

    let currentQuery = null;
    let freshFromQuery = 0;
    let listingsWithoutFresh = 0;

    while (!(await shouldStopCrawl(runId, config))) {
      if (!currentQuery || freshFromQuery >= threshold) {
        const nextResult = await planner.next();
        if (nextResult.done || !nextResult.query) {
          await log.info("Naukri selected queries exhausted — stopping platform crawl");
          break;
        }
        const { query, reasoning, source } = nextResult;
        currentQuery = query;
        freshFromQuery = 0;
        listingsWithoutFresh = 0;
        await updateCrawlProgress(runId, {
          naukri_current_query: currentQuery,
          naukri_fresh_from_query: 0,
          naukri_keyword_source: source || "fallback",
        });
        await pushQueryUsed(runId, "naukri", currentQuery);
        await log.info(`Naukri new query (${source || "fallback"}): "${currentQuery}"${reasoning ? ` — ${reasoning}` : ""}`, {
          keyword: currentQuery,
        });
        await emitAgentEvent({
          runId,
          candidateId: config.candidateId,
          stage: "discover",
          tool: "crawl_naukri",
          message: `Searching Naukri for "${currentQuery}"`,
        });
      }

      let listings = [];
      try {
        listings = await discoverKeyword(page, currentQuery, config, log);
      } catch (err) {
        await log.warn(`Search failed for "${currentQuery}": ${err.message}`);
        listingsWithoutFresh = 20;
        continue;
      }

      if (listings.length === 0) {
        await log.info(`No listings for "${currentQuery}" — rotating query`);
        freshFromQuery = threshold;
        continue;
      }

      await log.info(`Found ${listings.length} listings for "${currentQuery}"`);

      for (const listing of listings) {
        if (await shouldStopCrawl(runId, config)) break;
        if (freshFromQuery >= threshold) break;
        if (listingsWithoutFresh >= 20) break;
        if (seen.has(listing.job_url)) continue;
        seen.add(listing.job_url);
        stats.discovered += 1;

        try {
          const validated = await validateJob(
            page,
            { ...listing, search_keyword: currentQuery },
            profile,
            config
          );
          stats.validated += 1;

          if (validated.freshness === "stale") stats.stale += 1;
          if (validated.url_status === "dead") stats.dead += 1;
          if (validated.url_status === "valid_open") stats.valid_open += 1;

          const fresh = isFreshOpen(validated);

          await saveJob(validated, runId, config.candidateId);

          await incrementCrawlProgress(runId, {
            discovered: 1,
            validated: 1,
            naukri_fetched: 1,
            valid_open: validated.url_status === "valid_open" ? 1 : 0,
            fresh_found: fresh ? 1 : 0,
            stale: validated.freshness === "stale" ? 1 : 0,
            dead: validated.url_status === "dead" ? 1 : 0,
          });

          if (fresh) {
            freshFromQuery += 1;
            listingsWithoutFresh = 0;
            await updateCrawlProgress(runId, { naukri_fresh_from_query: freshFromQuery });
            planner.recordFresh(currentQuery, freshFromQuery);
          } else {
            listingsWithoutFresh += 1;
          }

          await log.info(
            `Naukri ${validated.freshness}/${validated.url_status} | score ${validated.match_score || 0} | ${validated.company || "?"} — ${validated.job_title}`,
            { job_url: validated.job_url }
          );
        } catch (err) {
          const raw = buildRawListingRecord(
            { ...listing, search_keyword: currentQuery },
            profile,
            config,
            err.message
          );
          await saveJob(raw, runId, config.candidateId);
          await incrementCrawlProgress(runId, {
            discovered: 1,
            naukri_fetched: 1,
            stale: raw.freshness === "stale" ? 1 : 0,
          });
          await log.warn(`Naukri partial save: ${listing.job_url} — ${err.message}`);
          listingsWithoutFresh += 1;
        }

        await delay(config.validateDelayMs);
      }

      await delay(config.searchDelayMs);
    }
  } finally {
    await context.close();
  }

  return stats;
}

module.exports = { runNaukriCrawl, discoverKeyword, validateJob };
