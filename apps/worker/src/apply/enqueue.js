const { ApplyVault, Application } = require("@jobportal/db");
const { isApplyEligible, portalKindForJob } = require("@jobportal/core");

function jobsToEnqueue(jobs, vault) {
  if (!vault?.auto_apply_enabled) return [];
  return (jobs || []).filter((job) => isApplyEligible({ job, vault }));
}

async function enqueueEligibleApplications({ userId, jobs }) {
  const vault = await ApplyVault.findOne({ user_id: userId }).lean();
  if (!vault?.auto_apply_enabled) return { enqueued: 0 };
  const eligible = jobsToEnqueue(jobs, vault);
  let enqueued = 0;
  for (const job of eligible) {
    const portal_kind = portalKindForJob(job);
    const res = await Application.updateOne(
      { user_id: userId, job_id: job._id },
      { $setOnInsert: { status: "queued", portal_kind, attempts: 0 } },
      { upsert: true }
    );
    if (res.upsertedCount) enqueued++;
  }
  return { enqueued };
}

module.exports = { jobsToEnqueue, enqueueEligibleApplications };
