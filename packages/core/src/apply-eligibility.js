function portalKindForJob(job) {
  if (job?.source === "naukri") return "naukri_easy";
  if (job?.source === "linkedin") return "linkedin_easy";
  return null;
}

function isApplyEligible({ job, vault }) {
  const kind = portalKindForJob(job);
  if (!kind) return false;
  if (job.status === "hidden") return false;
  if (job.link_status === "expired" || job.link_status === "dead") return false;
  const threshold = Number(vault?.match_threshold ?? 70);
  const score = Number(job?.match?.score);
  if (!Number.isFinite(score) || score < threshold) return false;
  return true;
}

module.exports = { portalKindForJob, isApplyEligible };