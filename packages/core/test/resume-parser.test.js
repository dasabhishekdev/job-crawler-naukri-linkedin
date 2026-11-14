const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { cleanText, resumeMimeType, parseResume } = require("../src/resume-parser");

test("cleanText keeps line structure but squeezes whitespace", () => {
  assert.equal(cleanText("Anika  Bhattacharyya\r\n\r\n\r\n\tWORK   EXPERIENCE \n• Item"), "Anika Bhattacharyya\n\nWORK EXPERIENCE\n• Item");
});

test("resumeMimeType only accepts pdf and docx", () => {
  assert.equal(resumeMimeType("cv.PDF"), "application/pdf");
  assert.ok(resumeMimeType("cv.docx").includes("wordprocessingml"));
  assert.equal(resumeMimeType("cv.exe"), null);
});

test("parseResume rejects unsupported files", async () => {
  await assert.rejects(parseResume(Buffer.from("x"), "cv.txt"), /PDF or DOCX/);
});

test("parseResume reads ReportLab PDFs (regression: 'bad XRef entry')", async () => {
  const pdf = fs.readFileSync(path.join(__dirname, "fixtures", "reportlab-sample.pdf"));
  const text = await parseResume(pdf, "reportlab-sample.pdf");
  assert.match(text, /^Test Candidate\n/);
  assert.match(text, /PROFESSIONAL SUMMARY/);
  assert.match(text, /Tracked purchase orders/);
  assert.doesNotMatch(text, /-- \d+ of \d+ --/, "page markers are stripped");
});

test("parseResume turns broken PDFs into a friendly error", async () => {
  await assert.rejects(parseResume(Buffer.from("%PDF-1.4\nnot really a pdf"), "broken.pdf"), /could not be read/i);
});
