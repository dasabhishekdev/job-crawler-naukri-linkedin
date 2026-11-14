const fs = require("fs");
const { chromium } = require("playwright");
const config = require("./config");
const { loadProfile, getJobKeywords } = require("./profile");
const { discoverKeyword } = require("./jobs/discovery");
const { validateJobUrl } = require("./jobs/validator");
const { SessionExpiredError } = require("./jobs/search");
const { analyzeJob } = require("./jobs/parser");
const { assignTier } = require("./jobs/tier");
const { randomDelay, delay } = require("./utils/delay");
const {
  getJobsNeedingValidation,
  getValidOpenCount,
  updateJobValidation,
  getStatusCounts,
  getTierCounts,
  closeJobsDb,
} = require("./storage/jobs-db");

function buildJobText(job, details) {
  return [
    details.job_title || job.job_title,
    details.company || job.company,
    details.location || job.location,
    details.description,
  ]
    .filter(Boolean)
    .join(" ");
}

async function validatePendingJobs(page, profile) {
  const pending = getJobsNeedingValidation(30);
  if (pending.length === 0) return 0;

  console.log(`\nValidating ${pending.length} pending jobs...`);
  let validatedOpen = 0;

  for (const job of pending) {
    if (getValidOpenCount() >= config.targetJobs) break;

    const attempts = (job.validation_attempts || 0) + 1;

    try {
      const result = await validateJobUrl(page, job.job_url);
      const text = buildJobText(job, result.details || {});
      const analysis = analyzeJob(text, profile, job.search_keyword);
      const tier = assignTier(analysis.match_score);

      updateJobValidation(job.job_url, {
        ...result.details,
        match_score: analysis.match_score,
        match_reasons: analysis.match_reasons,
        tier,
        url_status: result.url_status,
        apply_type: result.apply_type,
        validation_attempts: attempts,
      });

      if (result.url_status === "valid_open" && tier) {
        validatedOpen += 1;
        console.log(
          `  ✓ OPEN tier-${tier} (score ${analysis.match_score}): ${result.details?.job_title || job.job_title}`
        );
      } else if (result.url_status === "valid_open") {
        console.log(`  ~ OPEN but low relevance (score ${analysis.match_score}): ${job.job_url}`);
      } else {
        console.log(`  ✗ ${result.url_status}: ${job.job_title || job.job_url}`);
      }
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err;

      updateJobValidation(job.job_url, {
        url_status: "error",
        match_score: job.match_score || 0,
        match_reasons: [],
        tier: null,
        validation_attempts: attempts,
      });
      console.warn(`  ! error validating ${job.job_url}: ${err.message}`);

      if (err.message.includes("HTTP") || err.message.includes("ERR_")) {
        await delay(config.rateLimitPauseMs);
      }
    }

    await randomDelay(config.validateDelayMs, config.validateDelayMs + 1000);
  }

  return validatedOpen;
}

async function main() {
  if (!fs.existsSync(config.storageStatePath)) {
    console.error(
      `No session found at ${config.storageStatePath}.\n` +
        'Run "npm run login" first to save your LinkedIn session.'
    );
    process.exit(1);
  }

  const profile = loadProfile();
  const keywords = getJobKeywords(profile);
  const locations = [config.jobLocation, ...config.jobLocationFallbacks];

  console.log(`Profile: ${profile.name}`);
  console.log(`Target: ${config.targetJobs} validated open jobs`);
  console.log(`Keywords: ${keywords.length}`);
  console.log(`Locations: ${locations.join(" → ")}\n`);

  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({
    storageState: config.storageStatePath,
  });
  const page = await context.newPage();

  try {
    let locationIndex = 0;

    while (getValidOpenCount() < config.targetJobs && locationIndex < locations.length) {
      const location = locations[locationIndex];
      console.log(`\n=== Location: ${location} (${getValidOpenCount()}/${config.targetJobs} open) ===`);

      for (const keyword of keywords) {
        if (getValidOpenCount() >= config.targetJobs) break;

        console.log(`\n--- Discover: "${keyword}" ---`);
        try {
          await discoverKeyword(page, keyword, location);
        } catch (err) {
          if (err instanceof SessionExpiredError) throw err;
          console.warn(`  Discovery error for "${keyword}": ${err.message}`);
          await delay(config.rateLimitPauseMs);
          continue;
        }

        await validatePendingJobs(page, profile);
      }

      if (getValidOpenCount() >= config.targetJobs) break;

      locationIndex += 1;
      if (locationIndex < locations.length) {
        console.log(`\nExpanding to fallback location: ${locations[locationIndex]}`);
      }
    }

    // Final validation pass for any remaining pending
    while (
      getValidOpenCount() < config.targetJobs &&
      getJobsNeedingValidation(1).length > 0
    ) {
      await validatePendingJobs(page, profile);
    }

    const openCount = getValidOpenCount();
    const statusCounts = getStatusCounts();
    const tierCounts = getTierCounts();

    console.log(`\n=== Crawl Complete ===`);
    console.log(`Validated open (tier 1+2): ${openCount}/${config.targetJobs}`);
    console.log(`Status breakdown:`, statusCounts);
    console.log(`Tier breakdown:`, Object.fromEntries(tierCounts.map((r) => [`tier-${r.tier}`, r.count])));

    if (openCount < config.targetJobs) {
      console.log(
        `\nShortfall: ${config.targetJobs - openCount} jobs short. ` +
          `Add keywords to profile.json or expand locations.`
      );
    }

    console.log(`\nExport with: npm run export:jobs`);
  } finally {
    await browser.close();
    closeJobsDb();
  }
}

main().catch((err) => {
  console.error("Jobs crawler failed:", err.message);
  closeJobsDb();
  process.exit(1);
});
