const assert = require("assert");
const { computeQueryCount, sanitizeQuery } = require("./keyword-planner");

assert.strictEqual(computeQueryCount(20, 8), 5);
assert.strictEqual(computeQueryCount(30, 10), 5);
assert.strictEqual(computeQueryCount(50, 8), 9);
assert.strictEqual(computeQueryCount(5, 10), 3);

assert.strictEqual(sanitizeQuery("  purchase   executive  ", "naukri"), "purchase executive");
assert.ok(
  sanitizeQuery("operations analyst supply chain bangalore india extra words here", "linkedin")
    .split(" ").length <= 8
);

console.log("keyword-planner tests passed");
