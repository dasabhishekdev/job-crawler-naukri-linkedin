const test = require("node:test");
const assert = require("node:assert/strict");
const { planHash, queryKey, rankQueries, shouldRetire, normalizePlan } = require("../src/crawl/planner");

const now = new Date("2026-11-14T12:00:00Z");
const hoursAgo = (h) => new Date(now.getTime() - h * 3600000);

test("planHash changes only when search-relevant profile fields change", () => {
  const base = { target_roles: ["Buyer", "Analyst"], skills: ["Excel"], target_locations: ["Bengaluru"], experience_years: 2.4, headline: "x" };
  assert.equal(planHash(base), planHash({ ...base, target_roles: ["analyst", "buyer"], headline: "different" }));
  assert.notEqual(planHash(base), planHash({ ...base, target_locations: ["Pune"] }));
  assert.notEqual(planHash(base), planHash({ ...base, experience_years: 5 }));
});

test("queryKey normalises case, punctuation and spacing", () => {
  assert.equal(queryKey("  Procurement   Analyst, Bengaluru "), "procurement analyst bengaluru");
});

test("rankQueries prefers productive and untried queries, and rests recently used ones", () => {
  const queries = [
    { text: "dead", uses: 4, new_jobs: 0, good_matches: 0, last_used_at: hoursAgo(30) },
    { text: "great", uses: 3, new_jobs: 12, good_matches: 5, last_used_at: hoursAgo(30) },
    { text: "fresh", uses: 0, new_jobs: 0, good_matches: 0 },
    { text: "great-but-just-used", uses: 3, new_jobs: 12, good_matches: 5, last_used_at: hoursAgo(1) },
  ];
  const order = rankQueries(queries, now).map((q) => q.text);
  assert.deepEqual(order.slice(0, 2).sort(), ["fresh", "great"]);
  assert.equal(order[order.length - 1], "dead");
  assert.ok(order.indexOf("great") < order.indexOf("great-but-just-used"));
});

test("shouldRetire only retires planned queries that keep finding nothing", () => {
  assert.equal(shouldRetire({ origin: "plan", uses: 4, new_jobs: 0 }), true);
  assert.equal(shouldRetire({ origin: "plan", uses: 4, new_jobs: 1 }), false);
  assert.equal(shouldRetire({ origin: "user", uses: 9, new_jobs: 0 }), false);
});

test("normalizePlan cleans, de-duplicates and caps AI output", () => {
  const plan = normalizePlan({
    job_queries: [{ q: "Procurement Analyst Bengaluru", why: "title" }, { q: "procurement analyst  bengaluru" }, { q: "" }, "SAP Ariba jobs"],
    company_queries: [{ q: "quick commerce companies Bengaluru" }],
  });
  assert.deepEqual(plan.jobs.map((q) => q.text), ["Procurement Analyst Bengaluru", "SAP Ariba jobs"]);
  assert.equal(plan.companies.length, 1);
});
