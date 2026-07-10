function assignTier(matchScore, tier1Min = 5, tier2Min = 1) {
  if (matchScore >= tier1Min) return 1;
  if (matchScore >= tier2Min) return 2;
  return null;
}

function countsTowardTarget(job) {
  return job.url_status === "valid_open" && (job.tier === 1 || job.tier === 2);
}

module.exports = { assignTier, countsTowardTarget };
