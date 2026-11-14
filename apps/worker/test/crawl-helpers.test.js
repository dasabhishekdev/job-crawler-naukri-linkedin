const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeUrl,
  dedupeKey,
  isBlocked,
  matchesLocation,
  htmlToText,
  postedAgeDays,
} = require("../src/crawl/normalize");
const { atsCoverage } = require("../src/crawl/ats");
const {
  detectBoard,
  detectBoardFromHtml,
  mapGreenhouseJob,
  mapLeverJob,
  mapWorkdayJob,
  mapSmartRecruitersJob,
} = require("../src/crawl/career-boards");
const { buildSearchBatches } = require("../src/crawl/discovery");
const { toRecord } = require("../src/tasks/crawl");

test("normalizeUrl strips tracking params, hash and trailing slash", () => {
  assert.equal(
    normalizeUrl("https://Jobs.Lever.co/meesho/abc/?utm_source=x&lever-source=LinkedIn#apply"),
    "https://jobs.lever.co/meesho/abc"
  );
  assert.equal(
    normalizeUrl("https://in.indeed.com/viewjob?jk=d2273cfc45bc91d4&from=serp"),
    "https://in.indeed.com/viewjob?jk=d2273cfc45bc91d4"
  );
  assert.equal(normalizeUrl("javascript:alert(1)"), "");
  assert.equal(normalizeUrl("not a url"), "");
});

test("dedupeKey ignores company suffixes, case and punctuation", () => {
  assert.equal(
    dedupeKey("Broadridge Financial Solutions India Pvt Ltd", "Procurement Buyer - Process Analyst"),
    dedupeKey("Broadridge Financial Solutions", "procurement buyer process analyst")
  );
  assert.notEqual(dedupeKey("EY", "Analyst"), dedupeKey("EY", "Senior Analyst"));
});

test("isBlocked matches whole company words case-insensitively", () => {
  assert.equal(isBlocked("Amazon Development Centre India", ["Amazon"]), true);
  assert.equal(isBlocked("Amazonia Foods", ["Amazon"]), false);
  assert.equal(isBlocked("Flipkart", []), false);
});

test("matchesLocation uses city aliases, remote preference and lenient unknowns", () => {
  assert.equal(matchesLocation("Bangalore Urban, Karnataka", ["Bengaluru"]), true);
  assert.equal(matchesLocation("Gurugram, Haryana", ["Delhi NCR"]), true);
  assert.equal(matchesLocation("Mumbai, India", ["Bengaluru"]), false);
  assert.equal(matchesLocation("Remote", ["Bengaluru"], false), false);
  assert.equal(matchesLocation("Remote - India", ["Bengaluru"], true), true);
  assert.equal(matchesLocation("", ["Bengaluru"]), true);
  assert.equal(matchesLocation("India", ["Pune"]), true);
  assert.equal(matchesLocation("Anywhere", []), true);
});

test("matchesLocation compares the city part of 'City, State' targets", () => {
  assert.equal(matchesLocation("Bengaluru, Karnataka, India", ["Bangalore, Karnataka"]), true);
  assert.equal(matchesLocation("Bangalore", ["Bengaluru, India"]), true);
  assert.equal(matchesLocation("Chennai, Tamil Nadu", ["Bangalore, Karnataka"]), false);
});

test("toRecord reports why a posting was skipped", () => {
  const profile = { exclude_companies: ["Amazon"], target_locations: ["Bengaluru"], remote_ok: false };
  const base = { title: "Buyer", company: "Acme", apply_url: "https://acme.com/jobs/1", location: "Bengaluru" };
  assert.equal(toRecord(base, { profile, maxAgeDays: 14 }).skip, undefined);
  assert.equal(toRecord({ ...base, company: "Amazon India" }, { profile, maxAgeDays: 14 }).skip, "excluded company");
  assert.equal(toRecord({ ...base, location: "Mumbai" }, { profile, maxAgeDays: 14 }).skip, "location");
  assert.equal(toRecord({ ...base, posted: "30 days ago" }, { profile, maxAgeDays: 14 }).skip, "too old");
  assert.equal(toRecord({ ...base, apply_url: "" }, { profile, maxAgeDays: 14 }).skip, "missing details");
});

test("postedAgeDays reads relative text and ISO dates", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  assert.equal(postedAgeDays("2 days ago", now), 2);
  assert.equal(postedAgeDays("2026-11-04T00:00:00Z", now), 10);
  assert.equal(postedAgeDays("Not listed on posting", now), null);
  assert.equal(postedAgeDays("Posted 3+ weeks ago (Naukri mirror)", now), 21);
  assert.equal(postedAgeDays("30+ days ago", now), 30);
  assert.equal(postedAgeDays("a month ago", now), 30);
});

test("htmlToText decodes entities and strips tags", () => {
  assert.equal(htmlToText("&lt;p&gt;Hello &amp; <b>world</b>&lt;/p&gt;"), "Hello & world");
});

test("atsCoverage counts phrases, plurals and synonyms", () => {
  const resume = "Tracked customer POs and GRN follow-up. Vendor onboarding. Advanced Excel and SQL dashboards.";
  const result = atsCoverage(
    ["Purchase Order", "Goods Receipt Note", "vendor onboarding", "SQL", "SAP Ariba", "dashboard"],
    resume
  );
  assert.deepEqual(result.missing, ["SAP Ariba"]);
  assert.equal(result.score, 83);
  assert.equal(atsCoverage([], resume).score, null);
});

test("detectBoard recognises Greenhouse, Lever, Ashby and generic pages", () => {
  assert.equal(
    detectBoard("https://job-boards.eu.greenhouse.io/groww").api,
    "https://boards-api.greenhouse.io/v1/boards/groww/jobs?content=true"
  );
  assert.equal(detectBoard("https://jobs.lever.co/meesho").api, "https://api.lever.co/v0/postings/meesho?mode=json");
  assert.equal(detectBoard("https://jobs.ashbyhq.com/acme").type, "ashby");
  assert.equal(detectBoard("https://careers.swiggy.com/#/careers").type, "generic");
});

test("detectBoard recognises Workday and SmartRecruiters", () => {
  const wd = detectBoard("https://illumina.wd1.myworkdayjobs.com/en-US/illumina-careers/job/Bengaluru/Buyer_123");
  assert.equal(wd.type, "workday");
  assert.equal(wd.api, "https://illumina.wd1.myworkdayjobs.com/wday/cxs/illumina/illumina-careers/jobs");
  assert.equal(wd.base, "https://illumina.wd1.myworkdayjobs.com/illumina-careers");
  const site = detectBoard("https://wd3.myworkdaysite.com/recruiting/acme/External");
  assert.equal(site.api, "https://wd3.myworkdaysite.com/wday/cxs/acme/External/jobs");
  const sr = detectBoard("https://careers.smartrecruiters.com/BoschGroup");
  assert.equal(sr.type, "smartrecruiters");
  assert.equal(sr.api, "https://api.smartrecruiters.com/v1/companies/BoschGroup/postings?limit=100");
});

test("detectBoardFromHtml finds an embedded job system on a company careers page", () => {
  const html = '<a href="https://boards.greenhouse.io/acme/jobs/1">Jobs</a><iframe src="https://jobs.lever.co/other"></iframe>';
  assert.equal(detectBoardFromHtml(html).token, "acme");
  assert.equal(detectBoardFromHtml('<script src="https://acme.wd5.myworkdayjobs.com/en-US/External"></script>').type, "workday");
  assert.equal(detectBoardFromHtml("<p>No ATS here</p>"), null);
});

test("Workday and SmartRecruiters postings map to the common job shape", () => {
  const board = detectBoard("https://acme.wd5.myworkdayjobs.com/External");
  const wd = mapWorkdayJob(board, { title: "Buyer", externalPath: "/job/Bengaluru/Buyer_R1", locationsText: "Bengaluru, India", postedOn: "Posted 2 Days Ago" });
  assert.deepEqual(wd, { title: "Buyer", location: "Bengaluru, India", apply_url: "https://acme.wd5.myworkdayjobs.com/External/job/Bengaluru/Buyer_R1", posted: "Posted 2 Days Ago", description: "", detail: "/job/Bengaluru/Buyer_R1" });
  const sr = mapSmartRecruitersJob(detectBoard("https://jobs.smartrecruiters.com/BoschGroup/1"), {
    id: "744",
    name: "Purchasing Buyer",
    location: { fullLocation: "Bengaluru, Karnataka, India", city: "Bengaluru" },
    releasedDate: "2026-11-12T09:48:30.250Z",
    ref: "https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/744",
  });
  assert.equal(sr.apply_url, "https://jobs.smartrecruiters.com/BoschGroup/744");
  assert.equal(sr.location, "Bengaluru, Karnataka, India");
  assert.equal(sr.detail, "https://api.smartrecruiters.com/v1/companies/BoschGroup/postings/744");
});

test("board job mappers produce the common job shape", () => {
  const gh = mapGreenhouseJob({
    title: "Procurement Specialist",
    location: { name: "Bengaluru" },
    absolute_url: "https://job-boards.greenhouse.io/groww/jobs/1",
    content: "&lt;p&gt;Own vendor management&lt;/p&gt;",
  });
  assert.equal(gh.description, "Own vendor management");
  const lv = mapLeverJob({
    text: "Supply Chain Analyst",
    categories: { location: "Bangalore" },
    hostedUrl: "https://jobs.lever.co/meesho/2",
    descriptionPlain: "Analyse fill rates",
    lists: [{ text: "Requirements", content: "<li>Excel</li>" }],
  });
  assert.match(lv.description, /Excel/);
});

test("buildSearchBatches rotates roles and groups them by three", () => {
  const profile = { target_roles: ["a", "b", "c", "d", "e"] };
  const first = buildSearchBatches(profile, { searches: 2, rotation: 0 });
  assert.deepEqual(first, [["a", "b", "c"], ["d", "e"]]);
  const next = buildSearchBatches(profile, { searches: 1, rotation: 1 });
  assert.deepEqual(next, [["d", "e", "a"]]);
  assert.deepEqual(buildSearchBatches({ target_roles: [] }, { searches: 3 }), []);
});
