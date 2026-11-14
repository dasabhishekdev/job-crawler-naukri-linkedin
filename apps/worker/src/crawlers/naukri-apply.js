const fs = require("fs");
const { Application } = require("@jobportal/db");
const { answerApplicationQuestions, emitAgentEvent, resolveNaukriStoragePath, setAgentStage } = require("@jobportal/agent");
const { findResumePdf, delay } = require("../utils");

async function collectVisibleFields(page) {
  return page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("input, textarea, select"));
    const fields = [];
    nodes.forEach((el, index) => {
      if (el.type === "hidden" || el.type === "file" || el.type === "submit" || el.type === "button") return;
      const style = window.getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") return;
      const rect = el.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;

      let label = "";
      if (el.id) {
        const lab = document.querySelector(`label[for="${el.id}"]`);
        if (lab) label = lab.innerText;
      }
      if (!label) {
        const wrap = el.closest("label, .form-group, .chip, li, div");
        label = wrap?.innerText?.split("\n")[0] || "";
      }

      const options =
        el.tagName === "SELECT"
          ? Array.from(el.options)
              .map((o) => o.text?.trim())
              .filter(Boolean)
              .slice(0, 20)
          : [];

      fields.push({
        id: el.name || el.id || `field_${index}`,
        name: el.name || "",
        label: (label || el.placeholder || el.name || "").trim().slice(0, 120),
        type: el.type || el.tagName.toLowerCase(),
        tag: el.tagName.toLowerCase(),
        placeholder: el.placeholder || "",
        options,
      });
    });
    return fields.slice(0, 20);
  });
}

async function fillAnswer(page, field) {
  const locators = [];
  if (field.name) locators.push(page.locator(`[name="${field.name}"]`).first());
  if (field.id && field.id !== field.name && /^[A-Za-z_-][\w-]*$/.test(field.id)) {
    locators.push(page.locator(`#${field.id}`).first());
  }
  locators.push(page.getByLabel(field.label, { exact: false }).first());

  for (const loc of locators) {
    if (!(await loc.isVisible({ timeout: 800 }).catch(() => false))) continue;
    const tag = field.tag || field.type;
    if (tag === "select") {
      await loc.selectOption({ label: field.value }).catch(async () => {
        await loc.selectOption({ value: field.value }).catch(() => {});
      });
      return true;
    }
    if (field.type === "checkbox" || field.type === "radio") {
      const checked = /yes|true|1/i.test(field.value);
      if (checked) await loc.check().catch(() => {});
      return true;
    }
    await loc.fill(String(field.value)).catch(() => {});
    return true;
  }
  return false;
}

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
    if (await fileInput.isVisible({ timeout: 4000 }).catch(() => false)) {
      await fileInput.setInputFiles(resumePath);
      await delay(1000);
    }

    const fields = await collectVisibleFields(page);
    let formAnswers = [];
    if (fields.length > 0) {
      formAnswers = await answerApplicationQuestions({
        fields,
        resumeText: config.resumeText,
        profile: config.profile,
        prefs: config.applyPrefs,
        job,
        runId: config.runId,
      });
      for (const answer of formAnswers) {
        await fillAnswer(page, answer);
        await delay(200);
      }
    }

    const submitSelectors = [
      'button:has-text("Submit")',
      'button:has-text("Apply")',
      'button:has-text("Save and Apply")',
      'button:has-text("Send application")',
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
    const lower = bodyText.toLowerCase();
    const success =
      lower.includes("successfully applied") ||
      lower.includes("application submitted") ||
      lower.includes("already applied") ||
      lower.includes("you have applied");

    if (success) {
      await Application.create({
        job_id: job._id,
        candidate_id: config.candidateId,
        source: "naukri",
        status: "applied",
        resume_file: resumePath,
        form_answers: formAnswers,
      });
      return { status: "applied", form_answers: formAnswers };
    }

    return { status: "failed", error: "Could not confirm application success", form_answers: formAnswers };
  } catch (err) {
    return { status: "failed", error: err.message };
  }
}

async function runNaukriApply({ browser, jobs, config, log, candidate }) {
  const storagePath = candidate
    ? resolveNaukriStoragePath(candidate)
    : config.storageStatePath;

  if (!fs.existsSync(storagePath)) {
    await log.warn("No Naukri session found. Log in from Browser Login, then Save Session.");
    return { applied: 0, failed: 0, skipped: jobs.length };
  }

  const context = await browser.newContext({ storageState: storagePath });
  const page = await context.newPage();
  const stats = { applied: 0, failed: 0, skipped: 0 };

  try {
    for (const job of jobs) {
      await setAgentStage(config.runId, {
        current_tool: "apply_to_job",
        current_job_title: `${job.job_title || "Job"} @ ${job.company || ""}`.trim(),
      });
      await emitAgentEvent({
        runId: config.runId,
        candidateId: config.candidateId,
        stage: "apply",
        tool: "apply_to_job",
        message: `Applying: ${job.job_title} @ ${job.company}`,
        jobId: job._id,
      });

      const result = await applyToJob(page, job, config, log);

      if (result.status === "applied") {
        stats.applied += 1;
        job.application_status = "applied";
        job.applied_at = new Date();
        await job.save();
        await log.info(`Applied: ${job.job_title} @ ${job.company}`);
        await emitAgentEvent({
          runId: config.runId,
          candidateId: config.candidateId,
          stage: "apply",
          tool: "apply_to_job",
          message: `Applied at ${job.company} — ${job.job_title}`,
          jobId: job._id,
        });
      } else if (result.status === "skipped") {
        stats.skipped += 1;
        job.application_status = "skipped";
        job.application_error = result.error;
        await job.save();
        await emitAgentEvent({
          runId: config.runId,
          candidateId: config.candidateId,
          stage: "apply",
          tool: "apply_to_job",
          message: `Skipped ${job.job_title}: ${result.error}`,
          level: "warn",
          jobId: job._id,
        });
      } else {
        stats.failed += 1;
        job.application_status = "failed";
        job.application_error = result.error;
        await job.save();
        await log.warn(`Apply failed: ${job.job_title} — ${result.error}`);
        await emitAgentEvent({
          runId: config.runId,
          candidateId: config.candidateId,
          stage: "apply",
          tool: "apply_to_job",
          message: `Apply failed: ${job.job_title} — ${result.error}`,
          level: "error",
          jobId: job._id,
        });
      }

      await delay(config.applyDelayMs);
    }
  } finally {
    await context.close();
  }

  return stats;
}

module.exports = { runNaukriApply, applyToJob };
