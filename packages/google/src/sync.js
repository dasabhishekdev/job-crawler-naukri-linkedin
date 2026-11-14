const { Job } = require("@jobportal/db");
const { getAuthorizedClient } = require("./oauth");
const { ensureCandidateDrive, ensureFolder, uploadPdf, writeSheetValues, driveApi } = require("./drive");
const { buildSheetRows } = require("./sheet-rows");

const MAX_SHEET_ROWS = 2000;

function relevantJobsQuery(candidateId, minFit) {
  return {
    candidate_id: candidateId,
    $or: [
      { fit_score: { $gte: minFit } },
      { fit_score: null, ai_match_score: { $gte: minFit } },
    ],
  };
}

/** Rewrites the candidate's sheet with relevant jobs, newest first. Returns null when Google is not connected. */
async function syncCandidateSheet(candidate, { minFit = 50 } = {}) {
  const auth = await getAuthorizedClient();
  if (!auth) return null;
  const refs = await ensureCandidateDrive(auth, candidate);
  const jobs = await Job.find(relevantJobsQuery(candidate._id, minFit))
    .sort({ first_seen_at: -1, createdAt: -1 })
    .limit(MAX_SHEET_ROWS)
    .lean();
  await writeSheetValues(auth, refs.sheet_id, buildSheetRows(jobs));
  candidate.drive.last_synced_at = new Date();
  await candidate.save();
  return { sheet_url: refs.sheet_url, rows: jobs.length };
}

async function uploadTailoredResume(candidate, { company, title, filePath, fileName }) {
  const auth = await getAuthorizedClient();
  if (!auth) return null;
  const refs = await ensureCandidateDrive(auth, candidate);
  const folder = await ensureFolder(driveApi(auth), `${company} - ${title}`.slice(0, 120), refs.tailored_folder_id);
  const file = await uploadPdf(auth, { folderId: folder.id, name: fileName, filePath });
  return {
    drive_file_id: file.id,
    drive_url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
    folder_url: folder.webViewLink || `https://drive.google.com/drive/folders/${folder.id}`,
  };
}

module.exports = { syncCandidateSheet, uploadTailoredResume, relevantJobsQuery };
