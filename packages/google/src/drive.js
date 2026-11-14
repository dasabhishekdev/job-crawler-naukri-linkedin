const { Readable } = require("stream");
const { drive } = require("@googleapis/drive");
const { sheets } = require("@googleapis/sheets");
const { SHEET_HEADERS } = require("./sheet-rows");

const FOLDER_MIME = "application/vnd.google-apps.folder";
const SHEET_MIME = "application/vnd.google-apps.spreadsheet";
const ROOT_FOLDER_NAME = "Job Crawler";
const SHEET_TAB = "Jobs";

const driveApi = (auth) => drive({ version: "v3", auth });
const sheetsApi = (auth) => sheets({ version: "v4", auth });

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
  const q = [`name='${quote(name)}'`, "trashed=false", `'${parentId || "root"}' in parents`, mimeType && `mimeType='${mimeType}'`]
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

/** Creates or re-validates `Job Crawler/<name>/{sheet, Tailored Resumes}`; returns ids for user.drive. */
async function ensureUserDrive(auth, { name, refs = {} }) {
  const d = driveApi(auth);
  const next = { ...refs };
  if (!(await fileAlive(d, next.root_folder_id))) next.root_folder_id = (await ensureFolder(d, ROOT_FOLDER_NAME, null)).id;
  if (!(await fileAlive(d, next.user_folder_id))) next.user_folder_id = (await ensureFolder(d, name, next.root_folder_id)).id;
  if (!(await fileAlive(d, next.resumes_folder_id))) {
    next.resumes_folder_id = (await ensureFolder(d, "Tailored Resumes", next.user_folder_id)).id;
  }
  if (!(await fileAlive(d, next.sheet_id))) {
    const sheetName = `${name} – Job Matches`;
    const existing = await findChild(d, { name: sheetName, parentId: next.user_folder_id, mimeType: SHEET_MIME });
    const sheet = existing || (await createJobsSheet(auth, d, { name: sheetName, parentId: next.user_folder_id }));
    next.sheet_id = sheet.id;
    next.sheet_url = sheet.webViewLink || `https://docs.google.com/spreadsheets/d/${sheet.id}/edit`;
  }
  return next;
}

async function uploadPdf(auth, { folderId, name, buffer }) {
  const d = driveApi(auth);
  const media = { mimeType: "application/pdf", body: Readable.from(buffer) };
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

module.exports = { ensureUserDrive, ensureFolder, uploadPdf, writeSheetValues, driveApi };
