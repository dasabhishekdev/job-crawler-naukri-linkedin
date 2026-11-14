const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const MAX_CHARS = 20000;
const ALLOWED = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

function cleanText(raw) {
  return String(raw || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
    .split("\n")
    .map((line) => line.replace(/[ \t\u00a0]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function resumeMimeType(filename) {
  return ALLOWED[path.extname(filename || "").toLowerCase()] || null;
}

async function parseResume(buffer, filename) {
  const ext = path.extname(filename || "").toLowerCase();
  let text;
  switch (ext) {
    case ".pdf":
      text = (await pdfParse(buffer)).text;
      break;
    case ".docx":
      text = (await mammoth.extractRawText({ buffer })).value;
      break;
    default:
      throw new Error("Upload a PDF or DOCX resume.");
  }
  const cleaned = cleanText(text);
  if (cleaned.replace(/\s/g, "").length < 200) {
    throw new Error("We could not read text from this file. If it is a scanned PDF, upload a DOCX or a text-based PDF.");
  }
  return cleaned.slice(0, MAX_CHARS);
}

module.exports = { parseResume, cleanText, resumeMimeType, MAX_CHARS };
