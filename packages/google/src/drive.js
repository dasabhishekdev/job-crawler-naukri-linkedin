const fs = require("fs");
const { drive } = require("@googleapis/drive");
const { sheets } = require("@googleapis/sheets");
const { SHEET_HEADERS } = require("./sheet-rows");

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const ROOT_FOLDER_NAME = "Job Crawler";
const SHEET_TAB = "Jobs";

function driveApi(auth) {
  return drive({ version: "v3", auth });
}

function sheetsApi(auth) {
  return sheets({ version: "v4", auth });
}

function quote(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function fileAlive(d, fileId) {
  if (!fileId) return false;
  try {
    const { data } = await d.files.get({ fileId, fields: "id,trashed" });
    return !data.trashed;
  } catch (err) {
    if (err.code === 404 || err.status === 404) return false;
    throw err;
  }
}

async function findChild(d, { name, parentId, mimeType }) {
  const q = [
    `name='${quote(name)}'`,
    "trashed=false",
    `'${parentId || "root"}' in parents`,
    mimeType ? `mimeType='${mimeType}'` : null,
  ]
    .filter(Boolean)
    .join(" and ");
  const { data } = await d.files.list({ q, fields: "files(id,name,webViewLink)", pageSize: 1, spaces: "drive" });
  return data.files?.[0] || null;
}

async function ensureFolder(d, name, parentId) {
  const existing = await findChild(d, { name, parentId, mimeType: FOLDER_MIME });
  if (existing) return existing;
  const { data } = await d.files.create({
    requestBody: { name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined },
    fields: "id,name,webViewLink",
  });
  return data;
}

async function createJobsSheet(auth, d, { name, parentId }) {
  const { data: file } = await d.files.create({
    requestBody: { name, mimeType: SHEET_MIME, parents: [parentId] },
    fields: "id,webViewLink",
  });
  const s = sheetsApi(auth);
  const { data: meta } = await s.spreadsheets.get({ spreadsheetId: file.id, fields: "sheets.properties" });
  const sheetId = meta.sheets[0].properties.sheetId;
  await s.spreadsheets.batchUpdate({
    spreadsheetId: file.id,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: { sheetId, title: SHEET_TAB, gridProperties: { frozenRowCount: 1 } },
            fields: "title,gridProperties.frozenRowCount",
          },
        },
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true }, backgroundColor: { red: 0.9, green: 0.93, blue: 0.98 } } },
            fields: "userEnteredFormat(textFormat,backgroundColor)",
          },
        },
        {
          updateDimensionProperties: {
            range: { sheetId, dimension: "COLUMNS", startIndex: 9, endIndex: 10 },
            properties: { pixelSize: 420 },
            fields: "pixelSize",
          },
        },
      ],
    },
  });
  await s.spreadsheets.values.update({
    spreadsheetId: file.id,
    range: `${SHEET_TAB}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [SHEET_HEADERS] },
  });
  return file;
}

/** Creates (or re-validates) Job Crawler/<Name>/{sheet, Tailored Resumes} and stores the ids on the candidate. */
async function ensureCandidateDrive(auth, candidate) {
  const d = driveApi(auth);
  const refs = { ...(candidate.drive?.toObject?.() || candidate.drive || {}) };

  if (!(await fileAlive(d, refs.root_folder_id))) {
    refs.root_folder_id = (await ensureFolder(d, ROOT_FOLDER_NAME, null)).id;
  }
  if (!(await fileAlive(d, refs.candidate_folder_id))) {
    refs.candidate_folder_id = (await ensureFolder(d, candidate.name, refs.root_folder_id)).id;
  }
  if (!(await fileAlive(d, refs.tailored_folder_id))) {
    refs.tailored_folder_id = (await ensureFolder(d, "Tailored Resumes", refs.candidate_folder_id)).id;
  }
  if (!(await fileAlive(d, refs.sheet_id))) {
    const sheetName = `${candidate.name} – Job Matches`;
    const existing = await findChild(d, { name: sheetName, parentId: refs.candidate_folder_id, mimeType: SHEET_MIME });
    const sheet = existing || (await createJobsSheet(auth, d, { name: sheetName, parentId: refs.candidate_folder_id }));
    refs.sheet_id = sheet.id;
    refs.sheet_url = sheet.webViewLink || `https://docs.google.com/spreadsheets/d/${sheet.id}/edit`;
  }

  candidate.drive = refs;
  await candidate.save();
  return refs;
}

async function uploadPdf(auth, { folderId, name, filePath }) {
  const d = driveApi(auth);
  const media = { mimeType: "application/pdf", body: fs.createReadStream(filePath) };
  const existing = await findChild(d, { name, parentId: folderId });
  if (existing) {
    const { data } = await d.files.update({ fileId: existing.id, media, fields: "id,webViewLink" });
    return data;
  }
  const { data } = await d.files.create({
    requestBody: { name, parents: [folderId], mimeType: "application/pdf" },
    media,
    fields: "id,webViewLink",
  });
  return data;
}

async function writeSheetValues(auth, spreadsheetId, rows) {
  const s = sheetsApi(auth);
  await s.spreadsheets.values.clear({ spreadsheetId, range: SHEET_TAB });
  await s.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_TAB}!A1`,
    valueInputOption: "USER_ENTERED",
    requestBody: { values: rows },
  });
}

module.exports = { ensureCandidateDrive, ensureFolder, uploadPdf, writeSheetValues, driveApi };
