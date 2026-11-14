const path = require("path");
const { PDFParse } = require("pdf-parse");
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

const PAGE_MARKER = /^-- \d+ of \d+ --$/gm;

async function pdfText(buffer) {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    return (await parser.getText()).text.replace(PAGE_MARKER, "");
  } catch (err) {
    if (err?.name === "PasswordException") throw new Error("This PDF is password-protected. Remove the password and upload it again.");
    throw new Error("This PDF could not be read. Export it again from Word or Google Docs, or upload a DOCX.");
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function parseResume(buffer, filename) {
  const ext = path.extname(filename || "").toLowerCase();
  let text;
  switch (ext) {
    case ".pdf":
      text = await pdfText(buffer);
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
