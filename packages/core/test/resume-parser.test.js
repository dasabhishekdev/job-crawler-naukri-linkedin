const test = require("node:test");
const assert = require("node:assert/strict");
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
