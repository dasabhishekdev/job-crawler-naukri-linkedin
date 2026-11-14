const { getAuthUrl, connectWithCode, getAuthorizedClient, disconnectGoogle, googleStatus, googleConfigured } = require("./oauth");
const { syncCandidateSheet, uploadTailoredResume, relevantJobsQuery } = require("./sync");
const { buildSheetRows, SHEET_HEADERS } = require("./sheet-rows");

module.exports = {
  getAuthUrl,
  connectWithCode,
  getAuthorizedClient,
  disconnectGoogle,
  googleStatus,
  googleConfigured,
  syncCandidateSheet,
  uploadTailoredResume,
  relevantJobsQuery,
  buildSheetRows,
  SHEET_HEADERS,
};
