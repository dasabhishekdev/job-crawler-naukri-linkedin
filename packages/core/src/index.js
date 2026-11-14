const { loadProfile, getJobKeywords } = require("./profile");
const { analyzeJob, scoreJob } = require("./matcher");
const { assignTier, countsTowardTarget } = require("./tier");
const { parsePostedAgeDays, classifyFreshness, isStale } = require("./freshness");
const { parseResume, MAX_CHARS } = require("./resume-parser");
const {
  generateNextQuery,
  generateQueryBatch,
  computeQueryCount,
  planQueriesForCrawl,
  createPlanner,
  seedPlatformQuery,
  sanitizeQuery,
  PLATFORM_DEFAULTS,
  MODEL,
  buildChatCompletionParams,
} = require("./keyword-planner");
const { loadBlocklist } = require("./blocklist");

module.exports = {
  loadBlocklist,
  loadProfile,
  getJobKeywords,
  analyzeJob,
  scoreJob,
  assignTier,
  countsTowardTarget,
  parsePostedAgeDays,
  classifyFreshness,
  isStale,
  parseResume,
  MAX_CHARS,
  generateNextQuery,
  generateQueryBatch,
  computeQueryCount,
  planQueriesForCrawl,
  createPlanner,
  seedPlatformQuery,
  sanitizeQuery,
  PLATFORM_DEFAULTS,
  MODEL,
  buildChatCompletionParams,
};
