const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { Application, JobPosting, Resume, GeneratedResume, startOfDayIst } = require("@jobportal/db");
const { attemptsRemaining, portalKindForJob } = require("@jobportal/core");
const { contextOptions, loadConnectedStates, refreshConnection, markExpired } = require("@jobportal/portals");
const { applyNaukriEasy } = require("./naukri-easy");
const { applyLinkedInEasy } = require("./linkedin-easy");

const JOB_TIMEOUT_MS = 4 * 60 * 1000;
const PORTAL_BY_KIND = { naukri_easy: "naukri", linkedin_easy: "linkedin" };
const DEFAULT_ADAPTERS = { naukri_easy: applyNaukriEasy, linkedin_easy: applyLinkedInEasy };
const IN_FLIGHT = new Set(["classifying", "authenticating", "mapping_fields", "executing"]);
const noop = async () => {};
const silentLog = { info: noop, warn: noop, error: noop, job: noop };

function safeName(name) {
  return String(name || "resume.pdf").replace(/[^\w.-]+/g, "_") || "resume.pdf";
}

function isCancelled(err) {
  return err?.name === "RunCancelled";
}

function raceTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(message);
      err.name = "ApplyTimeoutError";
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function writeResumeTemp(userId, jobId) {
  const dir = await fs.mkdtemp(path.join(process.env.DATA_DIR || os.tmpdir(), "apply-resume-"));
  const cleanup = () => fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  const generated = await GeneratedResume.findOne({ user_id: userId, job_id: jobId, status: "done" })
    .select("+pdf")
    .sort("-createdAt");
  if (generated?.pdf?.length) {
    const filePath = path.join(dir, safeName(generated.filename || "resume.pdf"));
    await fs.writeFile(filePath, generated.pdf);
    return { resumePath: filePath, cleanup };
  }
  const resume = await Resume.findOne({ user_id: userId, is_current: true }).select("+data").sort("-createdAt");
  if (resume?.data?.length) {
    const filePath = path.join(dir, safeName(resume.filename || "resume.pdf"));
    await fs.writeFile(filePath, resume.data);
    return { resumePath: filePath, cleanup };
  }
  await cleanup();
  return { resumePath: "", cleanup: noop };
}

async function saveScreenshot(page, applicationId) {
  const dir = path.join(process.env.DATA_DIR || os.tmpdir(), "apply-screenshots");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${applicationId}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  return filePath;
}

async function countAttemptsToday(userId) {
  return Application.countDocuments({
    user_id: userId,
    attempt_counted: true,
    updatedAt: { $gte: startOfDayIst() },
  });
}

async function nextQueued(userId) {
  return Application.findOne({ user_id: userId, status: "queued" }).sort({ createdAt: 1 });
}

async function skipQueued(userId) {
  return Application.updateMany(
    { user_id: userId, status: "queued" },
    { $set: { status: "skipped_cap", last_error: "Daily apply cap reached" } }
  );
}

function mergeDeps(opts = {}) {
  return {
    findJob: opts.findJob || ((userId, jobId) => JobPosting.findOne({ _id: jobId, user_id: userId })),
    updateJob: opts.updateJob || ((userId, jobId, set) => JobPosting.updateOne({ _id: jobId, user_id: userId }, { $set: set })),
    loadConnectedStates: opts.loadConnectedStates || loadConnectedStates,
    refreshConnection: opts.refreshConnection || refreshConnection,
    markExpired: opts.markExpired || markExpired,
    writeResumeTemp: opts.writeResumeTemp || writeResumeTemp,
    saveScreenshot: opts.saveScreenshot || saveScreenshot,
    adapters: { ...DEFAULT_ADAPTERS, ...(opts.adapters || {}) },
    countAttemptsToday: opts.countAttemptsToday || countAttemptsToday,
    nextQueued: opts.nextQueued || nextQueued,
    skipQueued: opts.skipQueued || skipQueued,
    timeoutMs: opts.timeoutMs ?? JOB_TIMEOUT_MS,
  };
}

function recordAttempt(application, result) {
  if (!result?.attempted) return;
  application.attempt_counted = true;
  application.attempts = Number(application.attempts || 0) + 1;
}

function applyAdapterResult(application, result) {
  recordAttempt(application, result);
  if (result?.ok) {
    application.status = "applied";
    application.applied_at = application.applied_at || new Date();
    application.last_error = "";
    application.help_reason = "";
    return;
  }
  if (result?.needsHelp) {
    application.status = "needs_help";
    application.help_reason = result.reason || "checkpoint";
    application.last_error = result.reason || "";
    return;
  }
  application.status = "failed";
  application.last_error = result?.reason || "Apply failed";
}

/** Classify, authenticate, and run the Easy Apply adapter for one queued application. */
async function processApplication(opts) {
  const { application, user, vault, browser, run, stage, checkCancel = noop, log = silentLog } = opts;
  const {
    findJob,
    updateJob,
    loadConnectedStates: loadStates,
    refreshConnection: refresh,
    markExpired: expire,
    writeResumeTemp: writeResume,
    saveScreenshot: shot,
    adapters,
    timeoutMs,
  } = mergeDeps(opts);

  let context;
  let page;
  let resume = { resumePath: "", cleanup: noop };

  async function captureShot() {
    if (!page) return;
    try {
      const filePath = await shot(page, application._id);
      if (filePath) application.screenshot_refs = [...(application.screenshot_refs || []), filePath];
    } catch {
      /* keep going even if the screenshot fails */
    }
  }

  try {
    await checkCancel();
    const job = await findJob(user._id, application.job_id);
    if (!job) {
      application.status = "failed";
      application.last_error = "Job posting not found";
      await application.save();
      return application;
    }

    application.status = "classifying";
    application.portal_kind = portalKindForJob(job) || "unknown";
    if (run?._id) application.run_id = run._id;
    await application.save();
    await log.job?.(`${job.title} at ${job.company}`);
    await stage?.("classify", `${job.title} at ${job.company}`);
    await checkCancel();

    const portal = PORTAL_BY_KIND[application.portal_kind];
    const adapter = adapters[application.portal_kind];
    if (!portal || !adapter) {
      application.status = "failed";
      application.last_error = "Unsupported apply portal";
      await application.save();
      return application;
    }

    application.status = "authenticating";
    await application.save();
    await stage?.("auth", portal);
    const match = (await loadStates(user._id)).find((row) => row.portal === portal);
    if (!match?.storageState) {
      application.status = "needs_help";
      application.help_reason = "portal_disconnected";
      application.last_error = "Portal session missing or expired. Reconnect in Settings.";
      await application.save();
      return application;
    }

    resume = await writeResume(user._id, job._id || application.job_id);
    context = await browser.newContext({ ...contextOptions({ mobile: false }), storageState: match.storageState });
    page = await context.newPage();

    application.status = "executing";
    await application.save();
    await stage?.("apply", `${job.title} at ${job.company}`);

    let result;
    try {
      result = await raceTimeout(
        adapter({ page, jobUrl: job.job_url, vault: vault || {}, resumePath: resume.resumePath, log }),
        timeoutMs,
        "Apply timed out after 4 minutes"
      );
    } catch (err) {
      if (err.name === "ApplyTimeoutError") {
        application.status = "needs_help";
        application.help_reason = "timeout";
        application.last_error = err.message;
        await captureShot();
        await application.save();
        return application;
      }
      throw err;
    }

    applyAdapterResult(application, result);
    if (application.status === "applied") {
      await updateJob(user._id, job._id || application.job_id, { status: "applied" });
      await refresh(user._id, portal, await context.storageState()).catch(() => {});
      await log.info?.(`Applied: ${job.title} at ${job.company}`);
    } else {
      await captureShot();
      await log.warn?.(`${application.status}: ${job.title} (${application.help_reason || application.last_error})`);
    }
    await application.save();
    return application;
  } catch (err) {
    if (isCancelled(err)) {
      if (IN_FLIGHT.has(application.status)) {
        application.status = "queued";
        application.last_error = "";
        await application.save().catch(() => {});
      }
      throw err;
    }
    if (err?.name === "SessionExpiredError") {
      const portal = PORTAL_BY_KIND[application.portal_kind];
      if (portal) await expire(user._id, portal, err.message).catch(() => {});
      application.status = "needs_help";
      application.help_reason = "portal_disconnected";
      application.last_error = String(err.message || "").slice(0, 500);
      await captureShot();
      await application.save().catch(() => {});
      return application;
    }
    application.status = "failed";
    application.last_error = String(err.message || err).slice(0, 500);
    await captureShot();
    await application.save().catch(() => {});
    await log.warn?.(application.last_error);
    return application;
  } finally {
    await context?.close?.().catch(() => {});
    await resume.cleanup?.();
  }
}

/** Drain queued applications oldest-first until the IST daily attempt cap is hit. */
async function processQueuedApplications(opts) {
  const { user, vault, log = silentLog, checkCancel = noop } = opts;
  const deps = mergeDeps(opts);
  const cap = vault?.daily_attempt_cap ?? 20;
  const stats = { applied: 0, needs_help: 0, failed: 0, skipped_cap: 0, processed: 0 };

  let remaining = attemptsRemaining(cap, await deps.countAttemptsToday(user._id));
  while (remaining > 0) {
    await checkCancel();
    const application = await deps.nextQueued(user._id);
    if (!application) break;
    await processApplication({ ...opts, application, ...deps });
    stats.processed += 1;
    if (application.status === "applied") stats.applied += 1;
    else if (application.status === "needs_help") stats.needs_help += 1;
    else if (application.status === "failed") stats.failed += 1;
    remaining = attemptsRemaining(cap, await deps.countAttemptsToday(user._id));
  }

  if (remaining <= 0) {
    const skipped = await deps.skipQueued(user._id);
    stats.skipped_cap = skipped?.modifiedCount || 0;
  }
  await log.info?.(
    `Auto-apply finished: ${stats.applied} applied, ${stats.needs_help} need help, ${stats.failed} failed, ${stats.skipped_cap} skipped (cap)`
  );
  return stats;
}

module.exports = { processApplication, processQueuedApplications, JOB_TIMEOUT_MS };
