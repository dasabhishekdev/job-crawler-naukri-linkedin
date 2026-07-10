const fs = require("fs");
const { Application } = require("@jobportal/db");
const { findResumePdf, delay } = require("../utils");

async function applyToJob(page, job, config, log) {
  const resumePath = findResumePdf(config.resumeDir);

  if (!resumePath) {
    await log.warn("No resume PDF found in resume folder — skipping apply", {
      resume_dir: config.resumeDir,
    });
    return { status: "skipped", error: "No resume PDF found" };
  }

  if (job.apply_type !== "naukri" || job.url_status !== "valid_open") {
    return { status: "skipped", error: "Not eligible for Naukri apply" };
  }

  if (!job.tier || job.tier > 2) {
    return { status: "skipped", error: "Tier too low for auto-apply" };
  }

  try {
    await page.goto(job.job_url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await delay(2000);

    const applySelector =
      '#apply-button, button.apply-button, a#apply-button, .styles_apply-button__Kyb1s, button:has-text("Apply")';

    const applyBtn = page.locator(applySelector).first();
    if (!(await applyBtn.isVisible({ timeout: 5000 }).catch(() => false))) {
      return { status: "failed", error: "Apply button not found" };
    }

    await applyBtn.click();
    await delay(2000);

    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await fileInput.setInputFiles(resumePath);
      await delay(1000);
    }

    const submitSelectors = [
      'button:has-text("Submit")',
      'button:has-text("Apply")',
      'button:has-text("Save and Apply")',
      'button[type="submit"]',
    ];

    for (const selector of submitSelectors) {
      const btn = page.locator(selector).first();
      if (await btn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await btn.click();
        await delay(3000);
        break;
      }
    }

    const bodyText = (await page.textContent("body").catch(() => "")) || "";
    const success =
      bodyText.toLowerCase().includes("successfully applied") ||
      bodyText.toLowerCase().includes("application submitted") ||
      bodyText.toLowerCase().includes("already applied");

    if (success) {
      await Application.create({
        job_id: job._id,
        source: "naukri",
        status: "applied",
        resume_file: resumePath,
      });
      return { status: "applied" };
    }

    return { status: "failed", error: "Could not confirm application success" };
  } catch (err) {
    return { status: "failed", error: err.message };
  }
}

async function runNaukriApply({ browser, jobs, config, log }) {
  if (!fs.existsSync(config.storageStatePath)) {
    await log.warn("No Naukri session found. Run: npm run naukri:login -w @jobportal/worker");
    return { applied: 0, failed: 0, skipped: jobs.length };
  }

  const context = await browser.newContext({ storageState: config.storageStatePath });
  const page = await context.newPage();
  const stats = { applied: 0, failed: 0, skipped: 0 };

  try {
    for (const job of jobs) {
      const result = await applyToJob(page, job, config, log);

      if (result.status === "applied") {
        stats.applied += 1;
        job.application_status = "applied";
        job.applied_at = new Date();
        await job.save();
        await log.info(`Applied: ${job.job_title} @ ${job.company}`);
      } else if (result.status === "skipped") {
        stats.skipped += 1;
        job.application_status = "skipped";
        await job.save();
      } else {
        stats.failed += 1;
        job.application_status = "failed";
        job.application_error = result.error;
        await job.save();
        await log.warn(`Apply failed: ${job.job_title} — ${result.error}`);
      }

      await delay(config.applyDelayMs);
    }
  } finally {
    await context.close();
  }

  return stats;
}

module.exports = { runNaukriApply, applyToJob };
