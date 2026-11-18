const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { jobsToEnqueue, enqueueEligibleApplications, backfillEligibleApplications } = require("../src/apply/enqueue");

describe("jobsToEnqueue", () => {
  it("keeps only eligible naukri/linkedin jobs", () => {
    const vault = { match_threshold: 70, auto_apply_enabled: true };
    const jobs = [
      { _id: "1", source: "naukri", status: "new", match: { score: 80 } },
      { _id: "2", source: "web", status: "new", match: { score: 90 } },
      { _id: "3", source: "linkedin", status: "new", match: { score: 60 } },
    ];
    assert.deepEqual(
      jobsToEnqueue(jobs, vault).map((j) => String(j._id)),
      ["1"]
    );
  });
  it("returns empty when auto_apply disabled", () => {
    assert.equal(jobsToEnqueue([{ _id: "1", source: "naukri", status: "new", match: { score: 90 } }], { auto_apply_enabled: false, match_threshold: 70 }).length, 0);
  });
});

describe("enqueueEligibleApplications", () => {
  it("continues the batch when one upsert fails", async () => {
    const seen = [];
    const { enqueued } = await enqueueEligibleApplications({
      userId: "u1",
      vault: { auto_apply_enabled: true, match_threshold: 70 },
      jobs: [
        { _id: "1", source: "naukri", status: "new", match: { score: 90 } },
        { _id: "2", source: "linkedin", status: "new", match: { score: 80 } },
      ],
      upsert: async (_userId, job) => {
        if (String(job._id) === "1") throw new Error("duplicate key");
        seen.push(String(job._id));
        return { upsertedCount: 1 };
      },
    });
    assert.equal(enqueued, 1);
    assert.deepEqual(seen, ["2"]);
  });
});

describe("backfillEligibleApplications", () => {
  it("loads eligible jobs and enqueues them", async () => {
    const jobs = [{ _id: "1", source: "naukri", status: "new", match: { score: 90 } }];
    let passed;
    const result = await backfillEligibleApplications({
      userId: "u1",
      vault: { auto_apply_enabled: true, match_threshold: 70 },
      findJobs: async () => jobs,
      enqueue: async (args) => {
        passed = args;
        return { enqueued: 1 };
      },
    });
    assert.equal(result.enqueued, 1);
    assert.equal(passed.jobs, jobs);
    assert.equal(passed.userId, "u1");
  });
});
