const fs = require("fs");

function loadProfile(profilePath) {
  const raw = fs.readFileSync(profilePath, "utf8");
  return JSON.parse(raw);
}

function getJobKeywords(profile) {
  return profile.job_keywords || [];
}

module.exports = { loadProfile, getJobKeywords };
