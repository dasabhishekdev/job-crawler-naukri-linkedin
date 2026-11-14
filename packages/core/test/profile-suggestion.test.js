const test = require("node:test");
const assert = require("node:assert/strict");
const { suggestionChanges, applySuggestion, SUGGESTION_FIELDS } = require("../src/profile-suggestion");

const current = {
  full_name: "Anika Bhattacharyya",
  headline: "Supply Chain Analyst",
  current_location: "Bengaluru",
  summary: "Ops professional.",
  experience_years: 2,
  skills: ["Excel", "SQL", "Vendor Management"],
  target_roles: ["Supply Chain Analyst", "Procurement Analyst"],
  target_locations: ["Bengaluru"],
};

const suggested = {
  full_name: "ANIKA BHATTACHARYYA",
  headline: "Procurement and Supply Chain Operations",
  current_location: "Bengaluru",
  summary: "",
  experience_years: 2.4,
  skills: ["excel", "SQL", "GRN Follow-up", "Inventory Control"],
  target_roles: ["Procurement Analyst", "Operations Analyst"],
  target_locations: ["bengaluru"],
};

test("suggestionChanges lists only meaningful differences", () => {
  const changes = suggestionChanges(current, suggested);
  const byField = Object.fromEntries(changes.map((c) => [c.field, c]));
  assert.deepEqual(Object.keys(byField).sort(), ["experience_years", "headline", "skills", "target_roles"]);
  assert.equal(byField.headline.suggested, "Procurement and Supply Chain Operations");
  assert.deepEqual(byField.skills.added, ["GRN Follow-up", "Inventory Control"]);
  assert.deepEqual(byField.skills.removed, ["Vendor Management"]);
  assert.equal(byField.skills.list, true);
  assert.deepEqual(byField.target_roles.added, ["Operations Analyst"]);
  assert.ok(!("full_name" in byField), "case-only differences are ignored");
  assert.ok(!("summary" in byField), "empty suggestions never replace data");
  assert.ok(!("target_locations" in byField));
});

test("lists only count as changed when the analysis adds something", () => {
  const changes = suggestionChanges({ skills: ["Excel", "SQL", "GRN Follow-up"] }, { skills: ["excel", "GRN Follow-up"] });
  assert.deepEqual(changes, []);
});

test("city aliases count as the same city", () => {
  assert.deepEqual(suggestionChanges({ target_locations: ["Bengaluru"] }, { target_locations: ["Bangalore"] }), []);
  assert.deepEqual(suggestionChanges({ target_locations: ["Gurugram"] }, { target_locations: ["Gurgaon", "Pune"] })[0].added, ["Pune"]);
  assert.deepEqual(suggestionChanges({ current_location: "Bengaluru" }, { current_location: "Bangalore" }), []);
});

test("suggestionChanges handles a missing suggestion or profile", () => {
  assert.deepEqual(suggestionChanges(current, null), []);
  assert.equal(suggestionChanges({}, suggested).find((c) => c.field === "skills").added.length, 4);
});

test("applySuggestion returns a patch: scalars replaced, lists added to or replaced", () => {
  const patch = applySuggestion(current, suggested, { headline: "replace", skills: "add", target_roles: "replace", bogus: "replace" });
  assert.equal(patch.headline, "Procurement and Supply Chain Operations");
  assert.deepEqual(patch.skills, ["Excel", "SQL", "Vendor Management", "GRN Follow-up", "Inventory Control"]);
  assert.deepEqual(patch.target_roles, ["Procurement Analyst", "Operations Analyst"]);
  assert.ok(!("experience_years" in patch), "unselected fields are untouched");
  assert.ok(!("bogus" in patch));
  assert.ok(SUGGESTION_FIELDS.includes("target_locations"));
});
