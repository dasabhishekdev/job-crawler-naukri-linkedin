const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { vaultMissingFields, isVaultReady } = require("../src/apply-vault");
const { portalKindForJob, isApplyEligible } = require("../src/apply-eligibility");
const { attemptsRemaining } = require("../src/apply-cap");

describe("apply vault", () => {
  it("lists missing required fields", () => {
    assert.deepEqual(vaultMissingFields({}), ["full_name", "email", "phone"]);
    assert.equal(isVaultReady({ full_name: "A", email: "a@b.com", phone: "1" }), true);
  });
});

describe("apply eligibility", () => {
  it("maps naukri/linkedin sources only", () => {
    assert.equal(portalKindForJob({ source: "naukri" }), "naukri_easy");
    assert.equal(portalKindForJob({ source: "linkedin" }), "linkedin_easy");
    assert.equal(portalKindForJob({ source: "web" }), null);
  });
  it("requires score >= threshold and not hidden", () => {
    const vault = { match_threshold: 70 };
    assert.equal(isApplyEligible({ job: { source: "naukri", status: "new", match: { score: 71 } }, vault }), true);
    assert.equal(isApplyEligible({ job: { source: "naukri", status: "new", match: { score: 69 } }, vault }), false);
    assert.equal(isApplyEligible({ job: { source: "naukri", status: "hidden", match: { score: 90 } }, vault }), false);
  });
});

describe("apply cap", () => {
  it("computes remaining attempts", () => {
    assert.equal(attemptsRemaining(20, 5), 15);
    assert.equal(attemptsRemaining(20, 20), 0);
    assert.equal(attemptsRemaining(20, 25), 0);
  });
});