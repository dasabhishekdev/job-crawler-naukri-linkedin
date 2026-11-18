const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { jobsToEnqueue } = require("../src/apply/enqueue");

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
