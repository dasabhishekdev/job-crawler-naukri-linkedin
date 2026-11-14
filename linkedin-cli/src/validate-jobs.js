const fs = require("fs");
const { chromium } = require("playwright");
const config = require("./config");
const { loadProfile } = require("./profile");
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

async function main() {
  if (!fs.existsSync(config.storageStatePath)) {
    console.error(`No session found. Run "npm run login" first.`);
    process.exit(1);
  }

  const profile = loadProfile();
  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({
    storageState: config.storageStatePath,
  });
  const page = await context.newPage();

  console.log(`Re-validating pending and error jobs...\n`);

  try {
    let batch;
    do {
      batch = getJobsNeedingValidation(50);
      if (batch.length === 0) break;

      console.log(`Batch: ${batch.length} jobs`);

      for (const job of batch) {
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

          console.log(`  ${result.url_status}: ${result.details?.job_title || job.job_title}`);
        } catch (err) {
          if (err instanceof SessionExpiredError) throw err;
          updateJobValidation(job.job_url, {
            url_status: "error",
            match_score: job.match_score || 0,
            match_reasons: [],
            tier: null,
            validation_attempts: attempts,
          });
          console.warn(`  error: ${job.job_url} — ${err.message}`);
          await delay(config.rateLimitPauseMs);
        }

        await randomDelay(config.validateDelayMs, config.validateDelayMs + 1000);
      }
    } while (getJobsNeedingValidation(1).length > 0);

    const statusCounts = getStatusCounts();
    const tierCounts = getTierCounts();
    console.log(`\nDone. Valid open: ${getValidOpenCount()}`);
    console.log(`Status:`, statusCounts);
    console.log(`Tiers:`, Object.fromEntries(tierCounts.map((r) => [`tier-${r.tier}`, r.count])));
  } finally {
    await browser.close();
    closeJobsDb();
  }
}

main().catch((err) => {
  console.error("Validation failed:", err.message);
  closeJobsDb();
  process.exit(1);
});
