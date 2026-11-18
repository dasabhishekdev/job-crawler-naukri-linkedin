const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { scoreJobs } = require("../src/crawl/score");

function scoreJob(id) {
  return {
    _id: id,
    user_id: "u1",
    title: `Role ${id}`,
    company: "Acme",
    source: "naukri",
    status: "new",
    async save() {
      this.saved = true;
    },
  };
}

describe("scoreJobs enqueue on abort", () => {
  it("enqueues jobs already saved when a later batch throws BudgetExceededError", async () => {
    const job1 = scoreJob("1");
    const job2 = scoreJob("2");
    const enqueued = [];
    const ai = {
      provider: "openai",
      json: async (prompt) => {
        if (String(prompt).includes("id: 2")) {
          while (!job1.saved) await new Promise((r) => setImmediate(r));
          const err = new Error("Daily token budget exceeded");
          err.name = "BudgetExceededError";
          throw err;
        }
        return { results: [{ id: "1", fit: 88, relevancy: "High", summary: "good fit", keywords: ["excel"] }] };
      },
    };

    await assert.rejects(
      () =>
        scoreJobs({
          ai,
          jobs: [job1, job2],
          resumeText: "excel procurement",
          profile: {},
          log: { job: async () => {}, info: async () => {}, warn: async () => {} },
          checkCancel: async () => {},
          enqueue: async (args) => {
            enqueued.push(args);
            return { enqueued: args.jobs.length };
          },
        }),
      (err) => err.name === "BudgetExceededError"
    );

    assert.equal(job1.saved, true);
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].userId, "u1");
    assert.equal(enqueued[0].jobs.length, 1);
    assert.equal(String(enqueued[0].jobs[0]._id), "1");
  });
});
