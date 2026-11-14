const test = require("node:test");
const assert = require("node:assert/strict");
const { createBudget, BudgetExceededError } = require("../src/budget");

test("budget tracks usage and trips at the limit", () => {
  const b = createBudget({ budget: 10_000, used: 9_000 });
  assert.equal(b.exceeded(), false);
  assert.doesNotThrow(() => b.check());
  b.add(1_500);
  assert.equal(b.exceeded(), true);
  assert.throws(() => b.check(), (err) => err instanceof BudgetExceededError && /10,000/.test(err.message));
});

test("check(need) refuses calls that would overshoot, keeping a reserve for scoring", () => {
  const b = createBudget({ budget: 100_000, used: 70_000 });
  assert.doesNotThrow(() => b.check(10_000));
  assert.throws(() => b.check(40_000), BudgetExceededError);
  assert.throws(() => b.check(10_000, 0.25), BudgetExceededError, "25k reserve + 10k estimate does not fit in 30k");
  assert.doesNotThrow(() => b.check(10_000, 0.15));
});

test("a zero budget means unlimited", () => {
  const b = createBudget({ budget: 0, used: 99_000_000 });
  assert.equal(b.exceeded(), false);
  assert.doesNotThrow(() => b.check());
});
