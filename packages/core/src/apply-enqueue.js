const { ApplyVault, Application, JobPosting } = require("@jobportal/db");
const { isApplyEligible, portalKindForJob } = require("./apply-eligibility");

function jobsToEnqueue(jobs, vault) {
  if (!vault?.auto_apply_enabled) return [];
  return (jobs || []).filter((job) => isApplyEligible({ job, vault }));
}

async function defaultUpsert(userId, job) {
  const portal_kind = portalKindForJob(job);
  return Application.updateOne(
    { user_id: userId, job_id: job._id },
    { $setOnInsert: { status: "queued", portal_kind, attempts: 0 } },
    { upsert: true }
  );
}

async function enqueueEligibleApplications({ userId, jobs, vault, log, upsert = defaultUpsert }) {
  const resolved = vault === undefined ? await ApplyVault.findOne({ user_id: userId }).lean() : vault;
  if (!resolved?.auto_apply_enabled) return { enqueued: 0 };
  const eligible = jobsToEnqueue(jobs, resolved);
  let enqueued = 0;
  for (const job of eligible) {
    try {
      const res = await upsert(userId, job);
      if (res?.upsertedCount) enqueued++;
    } catch (err) {
      if (log) await log.warn(`Auto-apply enqueue skipped a job: ${err.message}`);
    }
  }
  return { enqueued };
}

async function backfillEligibleApplications({ userId, vault, log, findJobs, enqueue = enqueueEligibleApplications } = {}) {
  const resolved = vault || (await ApplyVault.findOne({ user_id: userId }).lean());
  if (!resolved?.auto_apply_enabled) return { enqueued: 0 };
  const threshold = Number(resolved.match_threshold ?? 70);
  const jobs = findJobs
    ? await findJobs(resolved)
    : await JobPosting.find({
        user_id: userId,
        source: { $in: ["naukri", "linkedin"] },
        status: { $ne: "hidden" },
        "match.score": { $gte: threshold },
      });
  const { enqueued } = await enqueue({ userId, jobs, vault: resolved, log });
  if (enqueued && log) await log.info(`Auto-apply backfill queued ${enqueued} job(s)`);
  return { enqueued };
}

module.exports = { jobsToEnqueue, enqueueEligibleApplications, backfillEligibleApplications };
