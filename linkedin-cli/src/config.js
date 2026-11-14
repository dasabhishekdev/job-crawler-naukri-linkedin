const path = require("path");

const ROOT = path.resolve(__dirname, "..");

function parseList(envValue) {
  if (!envValue) return null;
  return envValue.split("|").map((q) => q.trim()).filter(Boolean);
}

module.exports = {
  feedUrl: "https://www.linkedin.com/feed/",
  profilePath: process.env.PROFILE_PATH || path.join(ROOT, "profile.json"),
  scanMode: process.env.SCAN_MODE || "both",
  searchQueries: parseList(process.env.SEARCH_QUERIES),
  jobKeywords: parseList(process.env.JOB_KEYWORDS),
  jobLocation: process.env.JOB_LOCATION || "Bangalore, Karnataka, India",
  jobLocationFallbacks: parseList(process.env.JOB_LOCATION_FALLBACKS) || [
    "Karnataka, India",
    "India",
  ],
  targetJobs: Number(process.env.TARGET_JOBS) || 100,
  maxPagesPerKeyword: Number(process.env.MAX_PAGES_PER_KEYWORD) || 8,
  pageSize: 25,
  tier1MinScore: Number(process.env.TIER1_MIN_SCORE) || 5,
  tier2MinScore: Number(process.env.TIER2_MIN_SCORE) || 1,
  maxValidationAttempts: 3,
  maxScrolls: Number(process.env.MAX_SCROLLS) || 15,
  maxSearchScrolls: Number(process.env.MAX_SEARCH_SCROLLS) || 20,
  maxJobScrolls: Number(process.env.MAX_JOB_SCROLLS) || 25,
  minMatchScore: Number(process.env.MIN_MATCH_SCORE) || 2,
  minJobMatchScore: Number(process.env.MIN_JOB_MATCH_SCORE) || 1,
  headless: process.env.HEADLESS === "true",
  scrollDelayMs: Number(process.env.SCROLL_DELAY_MS) || 2500,
  validateDelayMs: Number(process.env.VALIDATE_DELAY_MS) || 1500,
  actionDelayMs: 1000,
  navRetryBackoffMs: [5000, 15000, 45000],
  rateLimitPauseMs: 60000,
  storageStatePath: path.join(ROOT, "storageState.json"),
  dbPath: path.join(ROOT, "leads.db"),
  jobsDbPath: path.join(ROOT, "jobs.db"),
};
