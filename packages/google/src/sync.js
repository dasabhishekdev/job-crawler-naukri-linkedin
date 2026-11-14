const { JobPosting, User } = require("@jobportal/db");
const { driveAuthForUser } = require("./oauth");
const { ensureUserDrive, ensureFolder, uploadPdf, writeSheetValues, driveApi } = require("./drive");
const { buildSheetRows } = require("./sheet-rows");

const MAX_SHEET_ROWS = 2000;

function folderName(user) {
  return user.name || user.email;
}

async function refreshDriveRefs(auth, user) {
  const refs = await ensureUserDrive(auth, { name: folderName(user), refs: user.drive?.toObject?.() || user.drive || {} });
  await User.updateOne({ _id: user._id }, { $set: Object.fromEntries(Object.entries(refs).map(([k, v]) => [`drive.${k}`, v])) });
  return refs;
}

/** Rewrites the user's sheet with relevant jobs, newest first. Returns null when Drive is not connected. */
async function syncUserSheet(user) {
  const auth = driveAuthForUser(user);
  if (!auth) return null;
  try {
    const refs = await refreshDriveRefs(auth, user);
    const minMatch = user.crawler?.min_match_to_sheet ?? 50;
    const jobs = await JobPosting.find({ user_id: user._id, status: { $ne: "hidden" }, "match.score": { $gte: minMatch } })
      .sort({ first_seen_at: -1 })
      .limit(MAX_SHEET_ROWS)
      .populate("latest_resume_id", "drive_url ats_after")
      .lean();
    await writeSheetValues(auth, refs.sheet_id, buildSheetRows(jobs));
    await User.updateOne({ _id: user._id }, { $set: { "drive.last_synced_at": new Date(), "drive.last_error": "" } });
    return { sheet_url: refs.sheet_url, rows: jobs.length };
  } catch (err) {
    await User.updateOne({ _id: user._id }, { $set: { "drive.last_error": err.message.slice(0, 300) } });
    throw err;
  }
}

async function uploadGeneratedResume(user, { company, title, fileName, buffer }) {
  const auth = driveAuthForUser(user);
  if (!auth) return null;
  const refs = await refreshDriveRefs(auth, user);
  const folder = await ensureFolder(driveApi(auth), `${company} - ${title}`.slice(0, 120), refs.resumes_folder_id);
  const file = await uploadPdf(auth, { folderId: folder.id, name: fileName, buffer });
  return file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`;
}

module.exports = { syncUserSheet, uploadGeneratedResume };
