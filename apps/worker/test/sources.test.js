const test = require("node:test");
const assert = require("node:assert/strict");
const {
  isAggregatorUrl,
  isAtsUrl,
  isGenuineUrl,
  classifyJobUrl,
  extractOfficialApplyUrl,
  companiesFromAggregatorJobs,
  preferGenuineJobs,
  guessCompanyWebsite,
} = require("../src/crawl/sources");

test("classifies aggregator, ATS and company career URLs", () => {
  assert.equal(classifyJobUrl("https://apna.co/job/flipkart-analyst").kind, "aggregator");
  assert.equal(classifyJobUrl("https://www.naukri.com/job-listings-buyer-acme").kind, "aggregator");
  assert.equal(classifyJobUrl("https://in.indeed.com/viewjob?jk=abc").kind, "aggregator");
  assert.equal(classifyJobUrl("https://jobs.lever.co/flipkart/abc").kind, "ats");
  assert.equal(classifyJobUrl("https://boards.greenhouse.io/swiggy/jobs/123").kind, "ats");
  assert.equal(classifyJobUrl("https://careers.flipkart.com/jobs/123").kind, "company");
  assert.equal(isAggregatorUrl("https://apna.co/x"), true);
  assert.equal(isGenuineUrl("https://jobs.lever.co/x/y"), true);
  assert.equal(isGenuineUrl("https://apna.co/x"), false);
  assert.equal(isAtsUrl("https://acme.wd5.myworkdayjobs.com/Careers"), true);
});

test("extractOfficialApplyUrl prefers ATS / company apply links on aggregator pages", () => {
  const html = `<html><body>
    <a href="https://apna.co/other">Similar jobs</a>
    <a href="https://jobs.lever.co/flipkart/abc123">Apply on company website</a>
    <a href="https://careers.flipkart.com/job/1">Careers</a>
  </body></html>`;
  assert.equal(
    extractOfficialApplyUrl(html, "https://apna.co/job/flipkart-analyst"),
    "https://jobs.lever.co/flipkart/abc123"
  );
  assert.equal(extractOfficialApplyUrl(`<a href="/local">x</a>`, "https://apna.co/job/1"), "");
});

test("companiesFromAggregatorJobs harvests unique employers from job-board URLs", () => {
  const companies = companiesFromAggregatorJobs([
    { title: "Buyer", company: "Flipkart", job_url: "https://apna.co/job/1" },
    { title: "Analyst", company: "Flipkart", apply_url: "https://www.naukri.com/job-listings-x" },
    { title: "SDE", company: "Swiggy", job_url: "https://careers.swiggy.com/jobs/1" },
    { title: "Ops", company: "Zepto", job_url: "https://in.indeed.com/viewjob?jk=1" },
  ]);
  assert.deepEqual(
    companies.map((c) => c.name).sort(),
    ["Flipkart", "Zepto"]
  );
  assert.match(companies.find((c) => c.name === "Flipkart").website, /flipkart\.com/);
});

test("preferGenuineJobs drops aggregator mirrors when a company/ATS URL exists", () => {
  const out = preferGenuineJobs([
    { title: "Buyer", company: "Flipkart", job_url: "https://apna.co/job/1", source: "web" },
    { title: "Buyer", company: "Flipkart", job_url: "https://jobs.lever.co/flipkart/abc", source: "career_page" },
    { title: "Analyst", company: "Swiggy", apply_url: "https://naukri.com/job-listings-y", source: "web" },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out.find((j) => j.company === "Flipkart").job_url, "https://jobs.lever.co/flipkart/abc");
  assert.match(out.find((j) => j.company === "Swiggy").apply_url, /naukri/);
});

test("guessCompanyWebsite only invents hosts for short brand names", () => {
  assert.equal(guessCompanyWebsite("Flipkart"), "https://www.flipkart.com");
  assert.equal(guessCompanyWebsite("Tata Consultancy Services"), "");
  assert.equal(guessCompanyWebsite("AB"), "");
});
