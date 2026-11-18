const { parsePostedAgeDays, classifyFreshness, isStale } = require("./freshness");
const { parseResume, cleanText, resumeMimeType, MAX_CHARS } = require("./resume-parser");
const { suggestionChanges, applySuggestion, SUGGESTION_FIELDS } = require("./profile-suggestion");
const { vaultMissingFields, isVaultReady, REQUIRED_VAULT_FIELDS } = require("./apply-vault");
const { portalKindForJob, isApplyEligible } = require("./apply-eligibility");
const { attemptsRemaining } = require("./apply-cap");

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
  vaultMissingFields,
  isVaultReady,
  REQUIRED_VAULT_FIELDS,
  portalKindForJob,
  isApplyEligible,
  attemptsRemaining,
};
