const test = require("node:test");
const assert = require("node:assert/strict");
const { looksExpiredText, isPastValidThrough } = require("../src/crawl/freshness-signals");
const { validateJobsOpen } = require("../src/crawl/validate");
const { parsePostedAgeDays } = require("@jobportal/core");

test("looksExpiredText catches common closed-job copy", () => {
  assert.equal(looksExpiredText("This job is no longer available"), true);
  assert.equal(looksExpiredText("Sorry, this posting has been filled"), true);
  assert.equal(looksExpiredText("Applications are closed"), true);
  assert.equal(looksExpiredText("We are hiring a Supply Chain Analyst in Bengaluru"), false);
});

test("isPastValidThrough uses schema.org deadlines", () => {
  assert.equal(isPastValidThrough("2020-01-01", new Date("2026-11-15")), true);
  assert.equal(isPastValidThrough("2099-01-01", new Date("2026-11-15")), false);
  assert.equal(isPastValidThrough("", new Date("2026-11-15")), false);
});

test("parsePostedAgeDays understands yesterday, hours and ISO dates", () => {
  const now = new Date("2026-11-15T12:00:00Z");
  assert.equal(parsePostedAgeDays("yesterday", now), 1);
  assert.equal(parsePostedAgeDays("3 hours ago", now), 0);
  assert.equal(parsePostedAgeDays("2026-11-01T00:00:00Z", now), 14); // Nov 1 → Nov 15
  assert.equal(parsePostedAgeDays("2 years ago", now), 730);
});

test("validateJobsOpen drops heuristic stale/expired without calling AI", async () => {
  let called = false;
  const ai = {
    json: async () => {
      called = true;
      return { results: [] };
    },
  };
  const { open, dropped } = await validateJobsOpen({
    ai,
    maxAgeDays: 14,
    jobs: [
      { title: "Old", company: "Acme", posted: "40 days ago", description: "Still listed" },
      { title: "Gone", company: "Acme", posted: "2 days ago", description: "This job is no longer available" },
    ],
  });
  assert.equal(open.length, 0);
  assert.equal(dropped, 2);
  assert.equal(called, false);
});

test("validateJobsOpen asks AI for ambiguous fresh listings", async () => {
  const ai = {
    json: async () => ({
      results: [
        { id: "0", status: "open", posted: "3 days ago" },
        { id: "1", status: "expired", reason: "filled" },
      ],
    }),
  };
  const { open, dropped } = await validateJobsOpen({
    ai,
    maxAgeDays: 14,
    jobs: [
      { title: "Buyer", company: "Acme", posted: "3 days ago", description: "Manage vendors" },
      { title: "Analyst", company: "Beta", posted: "1 day ago", description: "Analyse inventory" },
    ],
  });
  assert.equal(open.length, 1);
  assert.equal(open[0].title, "Buyer");
  assert.equal(dropped, 1);
});
