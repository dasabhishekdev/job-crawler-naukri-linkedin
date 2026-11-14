const { parsePostedAgeDays, classifyFreshness, isStale } = require("./freshness");
const { parseResume, cleanText, resumeMimeType, MAX_CHARS } = require("./resume-parser");
const { suggestionChanges, applySuggestion, SUGGESTION_FIELDS } = require("./profile-suggestion");

module.exports = {
  suggestionChanges,
  applySuggestion,
  SUGGESTION_FIELDS,
  parsePostedAgeDays,
  classifyFreshness,
  isStale,
  parseResume,
  cleanText,
  resumeMimeType,
  MAX_CHARS,
};
