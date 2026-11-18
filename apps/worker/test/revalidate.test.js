const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { revalidateHighMatchJobs } = require("../src/crawl/revalidate");

function fakeJob(overrides = {}) {
  const job = {
    user_id: "u1",
    _id: "j1",
    job_url: "https://www.naukri.com/job/1",
    status: "new",
    match: { score: 82 },
    description: "short",
    link_status: "unknown",
    link_checked_at: null,
    save: async function save() {
      this.saved = true;
      return this;
    },
    ...overrides,
  };
  return job;
}

describe("revalidateHighMatchJobs", () => {
  it("hides jobs whose page says sorry no jobs found", async () => {
    const job = fakeJob();
    const gone = [];
    const { Application } = require("@jobportal/db");
    const orig = Application.updateMany;
    Application.updateMany = async (...args) => {
      gone.push(args);
      return { modifiedCount: 1 };
    };
    try {
      const result = await revalidateHighMatchJobs({
        userId: "u1",
        findJobs: async () => [job],
        fetchPage: async () => ({ status: 200, html: "<html><body>Sorry! No jobs found</body></html>", finalUrl: job.job_url }),
        extractFromHtml: () => ({ expired: false, description: "Sorry! No jobs found" }),
      });
      assert.equal(result.expired, 1);
      assert.equal(job.status, "hidden");
      assert.equal(job.link_status, "expired");
      assert.equal(gone.length, 1);
    } finally {
      Application.updateMany = orig;
    }
  });

  it("marks 404 as dead and hides", async () => {
    const job = fakeJob({ _id: "j2" });
    const { Application } = require("@jobportal/db");
    const orig = Application.updateMany;
    Application.updateMany = async () => ({ modifiedCount: 0 });
    try {
      const result = await revalidateHighMatchJobs({
        userId: "u1",
        findJobs: async () => [job],
        fetchPage: async () => ({ status: 404, html: "", finalUrl: job.job_url }),
      });
      assert.equal(result.dead, 1);
      assert.equal(job.status, "hidden");
      assert.equal(job.link_status, "dead");
    } finally {
      Application.updateMany = orig;
    }
  });

  it("keeps open jobs and records link_status open", async () => {
    const job = fakeJob({ _id: "j3" });
    const result = await revalidateHighMatchJobs({
      userId: "u1",
      findJobs: async () => [job],
      fetchPage: async () => ({
        status: 200,
        html: "<html><body><h1>Buyer</h1><main>Manage P2P and vendors in Bengaluru</main></body></html>",
        finalUrl: job.job_url,
      }),
      extractFromHtml: () => ({ expired: false, description: "Manage P2P and vendors in Bengaluru" }),
    });
    assert.equal(result.open, 1);
    assert.equal(job.status, "new");
    assert.equal(job.link_status, "open");
    assert.ok(job.link_checked_at);
  });

  it("accepts force so recently checked jobs can be rechecked", async () => {
    const job = fakeJob({ _id: "j4", link_status: "open", link_checked_at: new Date() });
    const { Application } = require("@jobportal/db");
    const orig = Application.updateMany;
    Application.updateMany = async () => ({ modifiedCount: 0 });
    try {
      const result = await revalidateHighMatchJobs({
        userId: "u1",
        force: true,
        findJobs: async () => [job],
        fetchPage: async () => ({ status: 410, html: "", finalUrl: job.job_url }),
      });
      assert.equal(result.dead, 1);
      assert.equal(job.status, "hidden");
    } finally {
      Application.updateMany = orig;
    }
  });
});

describe("check_links task wiring", () => {
  it("registers check_links on the worker runner", () => {
    const { HANDLERS } = require("../src/runner");
    const { checkLinksTask } = require("../src/tasks/check-links");
    assert.equal(HANDLERS.check_links, checkLinksTask);
  });

  it("forces revalidate and counts expired/hidden", async () => {
    const { checkLinksTask } = require("../src/tasks/check-links");
    const src = require("fs").readFileSync(require.resolve("../src/tasks/check-links.js"), "utf8");
    assert.match(src, /force:\s*true/);
    assert.match(src, /revalidateHighMatchJobs/);
    assert.equal(typeof checkLinksTask, "function");
  });
});
