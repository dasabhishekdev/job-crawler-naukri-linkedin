const config = require("../config");

function assignTier(matchScore) {
  if (matchScore >= config.tier1MinScore) return 1;
  if (matchScore >= config.tier2MinScore) return 2;
  return null;
}

function countsTowardTarget(job) {
  return job.url_status === "valid_open" && (job.tier === 1 || job.tier === 2);
}

module.exports = { assignTier, countsTowardTarget };
