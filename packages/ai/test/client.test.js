const test = require("node:test");
const assert = require("node:assert/strict");
const { wrapProvider, isTransient } = require("../src/client");
const { estimateCost, modelInfo } = require("../src/pricing");

const usage = { input: 1000, output: 200, cache_read: 0, cache_write: 0, total: 1200 };
const noSleep = async () => {};

function fakeImpl(replies) {
  const calls = [];
  const next = async (prompt) => {
    calls.push(prompt);
    const reply = replies.shift();
    if (reply instanceof Error) throw reply;
    return { text: reply, usage };
  };
  return { calls, impl: { complete: next, search: next } };
}

test("retries transient errors with backoff, then succeeds", async () => {
  const { calls, impl } = fakeImpl([Object.assign(new Error("503 overloaded"), { status: 503 }), '{"ok":true}']);
  const seen = [];
  const ai = wrapProvider({ provider: "cursor", model: "composer-2.5", impl, onUsage: (u) => seen.push(u), sleep: noSleep });
  assert.deepEqual(await ai.json("hi", { label: "Test" }), { ok: true });
  assert.equal(calls.length, 2);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].purpose, "Test");
  assert.equal(seen[0].usage.total, 1200);
});

test("never retries rejected keys", async () => {
  const { calls, impl } = fakeImpl([Object.assign(new Error("401 invalid api key"), { status: 401 }), '{"ok":true}']);
  const ai = wrapProvider({ provider: "openai", model: "gpt-4o-mini", impl, sleep: noSleep });
  await assert.rejects(ai.json("hi"), (err) => err.name === "AiKeyError");
  assert.equal(calls.length, 1);
});

test("asks once more when the reply is not valid JSON", async () => {
  const { calls, impl } = fakeImpl(["Sure! Here you go", '{"fit": 80}']);
  const ai = wrapProvider({ provider: "cursor", model: "composer-2.5", impl, sleep: noSleep });
  assert.deepEqual(await ai.json("score"), { fit: 80 });
  assert.equal(calls.length, 2);
  assert.match(calls[1], /not valid JSON/);
});

test("gives up after the retry budget", async () => {
  const err = () => Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
  const { calls, impl } = fakeImpl([err(), err(), err(), "{}"]);
  const ai = wrapProvider({ provider: "cursor", model: "composer-2.5", impl, sleep: noSleep });
  await assert.rejects(ai.search("q"), /socket hang up/);
  assert.equal(calls.length, 3);
});

test("isTransient recognises rate limits, server errors and network failures", () => {
  assert.equal(isTransient(Object.assign(new Error("x"), { status: 429 })), true);
  assert.equal(isTransient(Object.assign(new Error("x"), { status: 502 })), true);
  assert.equal(isTransient(new Error("Request timed out")), true);
  assert.equal(isTransient(Object.assign(new Error("bad request"), { status: 400 })), false);
});

test("estimateCost uses list prices and flags plan-included Cursor models", () => {
  const composer = estimateCost("cursor", "composer-2.5", { input: 1_000_000, output: 100_000, cache_read: 0 });
  assert.equal(composer.usd, 0.75);
  assert.equal(composer.included_in_plan, true);
  assert.equal(estimateCost("openai", "gpt-4o-mini", { input: 2_000_000, output: 1_000_000 }).usd, 0.9);
  assert.equal(estimateCost("cursor", "mystery-model", usage).usd, null);
  assert.equal(modelInfo("cursor", "grok-4.7").included_in_plan, true);
  assert.equal(modelInfo("cursor", "claude-sonnet-5-5").included_in_plan, false);
});
