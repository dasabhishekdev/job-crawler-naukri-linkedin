const { JobPosting, Application } = require("@jobportal/db");
const { looksExpiredText } = require("./freshness-signals");
const enrich = require("./enrich");

const HIGH_MATCH = 70;
const MAX_PER_RUN = 20;
const RECHECK_AFTER_MS = 24 * 60 * 60 * 1000;

/**
 * Re-opens stored high-match job URLs. Hides expired/dead postings so the inbox
 * and auto-apply stop offering closed roles ("sorry, no jobs found", 404, etc.).
 */
async function revalidateHighMatchJobs({
  userId,
  minScore = HIGH_MATCH,
  limit = MAX_PER_RUN,
  force = false,
  log,
  checkCancel,
  now = new Date(),
  findJobs,
  fetchPage = enrich.fetchPage,
  extractFromHtml = enrich.extractFromHtml,
  isDeadStatus = enrich.isDeadStatus,
} = {}) {
  const staleBefore = new Date(now.getTime() - RECHECK_AFTER_MS);
  const filter = {
    user_id: userId,
    status: { $in: ["new", "saved"] },
    job_url: { $exists: true, $ne: "" },
  };
  if (minScore > 0) filter["match.score"] = { $gte: minScore };
  if (!force) {
    filter.$or = [{ link_checked_at: null }, { link_checked_at: { $lt: staleBefore } }, { link_status: "unknown" }];
  }
  const jobs = findJobs
    ? await findJobs()
    : await JobPosting.find(filter).sort({ "match.score": -1, first_seen_at: -1 }).limit(limit);

  let expired = 0;
  let dead = 0;
  let open = 0;

  for (const job of jobs) {
    if (checkCancel) await checkCancel();
    const page = await fetchPage(job.job_url);
    const checkedAt = new Date();

    if (isDeadStatus(page.status)) {
      await markGone(job, { link_status: "dead", link_checked_at: checkedAt });
      dead++;
      continue;
    }

    const html = page.html || "";
    const info = html ? extractFromHtml(html) : { expired: false, description: "" };
    const blob = `${info.description || ""}\n${html.slice(0, 20000)}`;
    if (info.expired || looksExpiredText(blob)) {
      await markGone(job, { link_status: "expired", link_checked_at: checkedAt });
      expired++;
      continue;
    }

    job.link_status = "open";
    job.link_checked_at = checkedAt;
    if (html && String(job.description || "").length < 300 && info.description?.length > String(job.description || "").length) {
      job.description = info.description;
    }
    await job.save();
    open++;
  }

  if (log && (expired || dead || open)) {
    await log.info(
      `Link check (≥${minScore}%): ${open} still open, ${expired} expired, ${dead} dead — closed ones moved to Hidden`
    );
  }
  return { checked: jobs.length, open, expired, dead };
}

async function markGone(job, { link_status, link_checked_at }) {
  job.status = "hidden";
  job.link_status = link_status;
  job.link_checked_at = link_checked_at;
  await job.save();
  await Application.updateMany(
    { user_id: job.user_id, job_id: job._id, status: { $in: ["queued", "skipped_cap", "needs_help"] } },
    {
      $set: {
        status: "failed",
        help_reason: link_status === "dead" ? "job_dead" : "job_expired",
        last_error: link_status === "dead" ? "Job link is dead (404/410)" : "Job posting expired or removed",
      },
    }
  );
}

module.exports = { revalidateHighMatchJobs, HIGH_MATCH, MAX_PER_RUN, RECHECK_AFTER_MS };
