const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeUrl,
  dedupeKey,
  extractJsonArray,
  isBlocked,
  isBengaluru,
  htmlToText,
  postedAgeDays,
} = require("../src/multi/normalize");
const { atsCoverage } = require("../src/multi/ats");
const { detectBoard, mapGreenhouseJob, mapLeverJob } = require("../src/multi/career-boards");

test("normalizeUrl strips tracking params, hash and trailing slash", () => {
  assert.equal(
    normalizeUrl("https://Jobs.Lever.co/meesho/abc/?utm_source=x&lever-source=LinkedIn#apply"),
    "https://jobs.lever.co/meesho/abc"
  );
  assert.equal(
    normalizeUrl("https://in.indeed.com/viewjob?jk=d2273cfc45bc91d4&from=serp"),
    "https://in.indeed.com/viewjob?jk=d2273cfc45bc91d4"
  );
  assert.equal(normalizeUrl("not a url"), "");
});

test("dedupeKey ignores company suffixes, case and punctuation", () => {
  assert.equal(
    dedupeKey("Broadridge Financial Solutions India Pvt Ltd", "Procurement Buyer - Process Analyst"),
    dedupeKey("Broadridge Financial Solutions", "procurement buyer process analyst")
  );
  assert.notEqual(dedupeKey("EY", "Analyst"), dedupeKey("EY", "Senior Analyst"));
});

test("extractJsonArray handles fences, prose and wrapped objects", () => {
  assert.deepEqual(extractJsonArray('Here you go:\n```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assert.deepEqual(extractJsonArray('{"jobs":[{"a":2}]}'), [{ a: 2 }]);
  assert.deepEqual(extractJsonArray("no json here"), []);
});

test("isBlocked matches whole company words case-insensitively", () => {
  assert.equal(isBlocked("Amazon Development Centre India", ["Amazon"]), true);
  assert.equal(isBlocked("amazon", ["Amazon"]), true);
  assert.equal(isBlocked("Amazonia Foods", ["Amazon"]), false);
  assert.equal(isBlocked("Flipkart", ["Amazon"]), false);
});

test("isBengaluru accepts Bangalore variants and unknown locations", () => {
  assert.equal(isBengaluru("Bengaluru, Karnataka"), true);
  assert.equal(isBengaluru("Bangalore Urban"), true);
  assert.equal(isBengaluru("Mumbai, India"), false);
  assert.equal(isBengaluru(""), true);
});

test("postedAgeDays reads relative text and ISO dates", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  assert.equal(postedAgeDays("2 days ago", now), 2);
  assert.equal(postedAgeDays("2026-11-04T00:00:00Z", now), 10);
  assert.equal(postedAgeDays("Not listed on posting", now), null);
  assert.equal(postedAgeDays("", now), null);
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
  assert.deepEqual(detectBoard("https://job-boards.eu.greenhouse.io/groww"), {
    type: "greenhouse",
    token: "groww",
    api: "https://boards-api.greenhouse.io/v1/boards/groww/jobs?content=true",
  });
  assert.equal(detectBoard("https://jobs.lever.co/meesho").api, "https://api.lever.co/v0/postings/meesho?mode=json");
  assert.equal(detectBoard("https://jobs.eu.lever.co/acme/123").api, "https://api.eu.lever.co/v0/postings/acme?mode=json");
  assert.equal(detectBoard("https://jobs.ashbyhq.com/acme").type, "ashby");
  assert.equal(detectBoard("https://careers.swiggy.com/#/careers").type, "generic");
});

test("board job mappers produce the common job shape", () => {
  const gh = mapGreenhouseJob({
    title: "Procurement Specialist",
    location: { name: "Bengaluru" },
    absolute_url: "https://job-boards.greenhouse.io/groww/jobs/1",
    content: "&lt;p&gt;Own vendor management&lt;/p&gt;",
    updated_at: "2026-11-10T00:00:00Z",
  });
  assert.equal(gh.title, "Procurement Specialist");
  assert.equal(gh.location, "Bengaluru");
  assert.equal(gh.description, "Own vendor management");

  const lv = mapLeverJob({
    text: "Supply Chain Analyst",
    categories: { location: "Bangalore" },
    hostedUrl: "https://jobs.lever.co/meesho/2",
    descriptionPlain: "Analyse fill rates",
    lists: [{ text: "Requirements", content: "<li>Excel</li>" }],
    createdAt: 1762732800000,
  });
  assert.equal(lv.apply_url, "https://jobs.lever.co/meesho/2");
  assert.match(lv.description, /Analyse fill rates/);
  assert.match(lv.description, /Excel/);
});
