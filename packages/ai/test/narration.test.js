const test = require("node:test");
const assert = require("node:assert/strict");
const { createNarrator } = require("../src/narration");

function collect(chunks, opts) {
  const lines = [];
  const n = createNarrator((line) => lines.push(line), opts);
  for (const c of chunks) n.push(c);
  n.flush();
  return lines;
}

test("joins streamed chunks into sentences", () => {
  const chunks = ["Searching", " for", " an open Procurement", " Analyst role in Bengal", "uru.", " Opening the", " Zepto listing", " page.\n"];
  assert.deepEqual(collect(chunks), [
    "Searching for an open Procurement Analyst role in Bengaluru.",
    "Opening the Zepto listing page.",
  ]);
});

test("stops narrating once the JSON answer starts", () => {
  const chunks = ["Found 3 roles.", " ```json\n[{\"title\":", "\"Buyer\"}]\n```", " Done."];
  assert.deepEqual(collect(chunks), ["Found 3 roles."]);
  assert.deepEqual(collect(['[{"title":"Buyer"}]']), []);
});

test("drops fragments and caps the number of lines", () => {
  assert.deepEqual(collect(["Ok. ", "Hm. ", "Checking the careers page now."]), ["Checking the careers page now."]);
  const many = Array.from({ length: 10 }, (_, i) => `Looking at listing number ${i}. `);
  assert.equal(collect(many, { max: 3 }).length, 3);
  const long = collect([`${"word ".repeat(80)}end.`]);
  assert.ok(long[0].length <= 241);
});
