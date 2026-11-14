const { buildJobSearchUrl } = require("./jobs/search");
const { classifyFromText } = require("./jobs/validator");
const { assignTier } = require("./jobs/tier");
const config = require("./config");

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}`);
  }
}

console.log("Pagination URL:");
const url0 = buildJobSearchUrl("supply chain", "Bangalore", 0);
const url25 = buildJobSearchUrl("supply chain", "Bangalore", 25);
assert(url0.includes("keywords=supply"), "includes keywords");
assert(!url0.includes("start="), "start=0 omitted");
assert(url25.includes("start=25"), "start=25 present");

console.log("\nValidator classification:");
assert(
  classifyFromText("This job is no longer accepting applications") === "valid_closed",
  "detects closed"
);
assert(
  classifyFromText("Job no longer available") === "dead",
  "detects dead"
);
assert(classifyFromText("Apply now for Supply Chain Analyst") === null, "open text returns null");

console.log("\nTier assignment:");
const oldTier1 = config.tier1MinScore;
const oldTier2 = config.tier2MinScore;
config.tier1MinScore = 5;
config.tier2MinScore = 1;
assert(assignTier(8) === 1, "score 8 → tier 1");
assert(assignTier(3) === 2, "score 3 → tier 2");
assert(assignTier(0) === null, "score 0 → null");
config.tier1MinScore = oldTier1;
config.tier2MinScore = oldTier2;

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
