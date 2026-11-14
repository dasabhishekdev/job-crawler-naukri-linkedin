const test = require("node:test");
const assert = require("node:assert/strict");
const { parseTopCard, fromDocumentTitle } = require("../src/portals/linkedin");
const { toRecord } = require("../src/tasks/crawl");

test("LinkedIn top card text gives location and posted time", () => {
  assert.deepEqual(parseTopCard("Bengaluru, Karnataka, India · 2 days ago · Over 100 applicants"), {
    location: "Bengaluru, Karnataka, India",
    posted: "2 days ago",
  });
  assert.deepEqual(parseTopCard(""), { location: "", posted: "" });
});

test("LinkedIn document titles carry title and company", () => {
  assert.deepEqual(fromDocumentTitle("(3) Procurement Analyst | Acme India | LinkedIn"), { title: "Procurement Analyst", company: "Acme India" });
  assert.deepEqual(fromDocumentTitle("LinkedIn"), {});
});

test("portal postings keep their source through toRecord", () => {
  const profile = { exclude_companies: [], target_locations: ["Bengaluru"], remote_ok: false };
  const rec = toRecord(
    { source: "linkedin", title: "Buyer", company: "Acme", apply_url: "https://www.linkedin.com/jobs/view/4012345678/", location: "Bengaluru", source_site: "LinkedIn · recommended" },
    { profile, maxAgeDays: 14 }
  );
  assert.equal(rec.source, "linkedin");
  assert.equal(rec.job_url, "https://www.linkedin.com/jobs/view/4012345678");
  assert.equal(toRecord({ source: "weird", title: "A", company: "B", apply_url: "https://x.com/1" }, { profile, maxAgeDays: 14 }).source, "web");
});
