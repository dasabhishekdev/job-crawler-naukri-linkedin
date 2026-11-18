const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { RUN_KINDS, APPLICATION_STATUSES, APPLY_PORTAL_KINDS } = require("@jobportal/db");

describe("auto-apply models", () => {
  it("includes auto_apply run kind", () => {
    assert.ok(RUN_KINDS.includes("auto_apply"));
  });
  it("exports application statuses", () => {
    for (const s of ["queued", "classifying", "authenticating", "mapping_fields", "executing", "applied", "needs_help", "failed", "skipped_cap"]) {
      assert.ok(APPLICATION_STATUSES.includes(s), s);
    }
  });
  it("exports phase-1 portal kinds", () => {
    assert.ok(APPLY_PORTAL_KINDS.includes("naukri_easy"));
    assert.ok(APPLY_PORTAL_KINDS.includes("linkedin_easy"));
  });
});