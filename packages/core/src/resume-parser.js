const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const MAX_CHARS = 12000;

async function parseResume(buffer, filename) {
  const ext = path.extname(filename || "").toLowerCase();
  let text = "";

  if (ext === ".pdf") {
    const data = await pdfParse(buffer);
    text = data.text || "";
  } else if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value || "";
  } else if (ext === ".md" || ext === ".txt") {
    text = buffer.toString("utf8");
  } else {
    throw new Error(`Unsupported file type: ${ext}. Use PDF, DOCX, MD, or TXT.`);
  }

  text = text.replace(/\s+/g, " ").trim();
  if (text.length < 100) {
    throw new Error(
      "Resume text too short — check the file is not empty or image-only (scanned PDF)."
    );
  }
  return text.slice(0, MAX_CHARS);
}

module.exports = { parseResume, MAX_CHARS };
