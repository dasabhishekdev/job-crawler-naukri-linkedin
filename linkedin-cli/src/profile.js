const fs = require("fs");
const config = require("./config");

function loadProfile() {
  if (!fs.existsSync(config.profilePath)) {
    throw new Error(`Profile not found at ${config.profilePath}`);
  }

  const profile = JSON.parse(fs.readFileSync(config.profilePath, "utf8"));

  return {
    ...profile,
    target_roles: (profile.target_roles || []).map((s) => s.toLowerCase()),
    skills: (profile.skills || []).map((s) => s.toLowerCase()),
    locations: (profile.locations || []).map((s) => s.toLowerCase()),
    search_queries: profile.search_queries || [],
    job_keywords: profile.job_keywords || [],
  };
}

function getSearchQueries(profile) {
  if (config.searchQueries?.length) {
    return config.searchQueries;
  }
  return profile.search_queries || [];
}

function getJobKeywords(profile) {
  if (config.jobKeywords?.length) {
    return config.jobKeywords;
  }
  return profile.job_keywords || [];
}

module.exports = { loadProfile, getSearchQueries, getJobKeywords };
