const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSheetRows, SHEET_HEADERS } = require("../src/sheet-rows");

const jobs = [
  {
    first_seen_at: new Date("2026-11-14T12:30:00Z"),
    fit_score: 82,
    ats_score: 60,
    relevancy: "High",
    company: "EY",
    job_title: "Procurement Analyst",
    location: "Bengaluru",
    source: "web",
    source_site: "EY Careers",
    job_url: 'https://careers.ey.com/job/1?x="y"',
    summary: "=SUM(A1) looks like a formula",
    tailored: { status: "done", drive_url: "https://drive.google.com/file/d/abc", ats_score: 85 },
    application_status: "pending",
  },
  {
    scraped_at: new Date("2026-11-13T04:00:00Z"),
    ai_match_score: 71,
    company: "Acme",
    job_title: "Ops Executive",
    source: "naukri",
    job_url: "https://www.naukri.com/job/2",
    application_status: "applied",
  },
];

test("header and row shape", () => {
  const rows = buildSheetRows(jobs);
  assert.deepEqual(rows[0], SHEET_HEADERS);
  assert.equal(rows.length, 3);
  assert.equal(rows[1].length, SHEET_HEADERS.length);
});

test("formats IST dates, scores, links and escapes formulas", () => {
  const [, first, second] = buildSheetRows(jobs);
  assert.equal(first[0], "14 Nov 2026, 18:00");
  assert.equal(first[1], 82);
  assert.equal(first[2], 60);
  assert.equal(first[7], "EY Careers");
  assert.equal(first[8], '=HYPERLINK("https://careers.ey.com/job/1?x=""y""","Apply")');
  assert.equal(first[9], "'=SUM(A1) looks like a formula");
  assert.equal(first[10], '=HYPERLINK("https://drive.google.com/file/d/abc","Resume PDF")');
  assert.equal(first[11], 85);
  assert.equal(second[1], 71);
  assert.equal(second[7], "Naukri");
  assert.equal(second[12], "Applied");
});
