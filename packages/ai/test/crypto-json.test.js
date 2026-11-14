const test = require("node:test");
const assert = require("node:assert/strict");

process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

const { encryptSecret, decryptSecret, last4 } = require("../src/crypto");
const { extractJsonArray, extractJsonObject } = require("../src/json");
const { classifyAiError, AiKeyError } = require("../src/errors");

test("encrypts and decrypts secrets with random IVs", () => {
  const a = encryptSecret("sk-test-123456");
  const b = encryptSecret("sk-test-123456");
  assert.notEqual(a, b);
  assert.match(a, /^v1:/);
  assert.equal(decryptSecret(a), "sk-test-123456");
  assert.equal(last4("sk-test-123456"), "3456");
});

test("rejects tampered ciphertext", () => {
  const parts = encryptSecret("secret").split(":");
  parts[3] = Buffer.from("tampered").toString("base64");
  assert.throws(() => decryptSecret(parts.join(":")));
});

test("extractJsonArray handles fences, prose and wrapped objects", () => {
  assert.deepEqual(extractJsonArray('Here:\n```json\n[{"a":1}]\n```'), [{ a: 1 }]);
  assert.deepEqual(extractJsonArray('{"jobs":[{"a":2}]}'), [{ a: 2 }]);
  assert.deepEqual(extractJsonArray("no json"), []);
});

test("extractJsonObject finds the object in prose", () => {
  assert.deepEqual(extractJsonObject('Sure! {"fit": 80} done'), { fit: 80 });
  assert.throws(() => extractJsonObject("nothing"));
});

test("classifyAiError turns auth failures into AiKeyError", () => {
  const err = classifyAiError(Object.assign(new Error("401 Your API key has expired"), { status: 401 }), "openai");
  assert.ok(err instanceof AiKeyError);
  assert.match(err.message, /OpenAI key was rejected/);
  const other = classifyAiError(new Error("socket hang up"), "cursor");
  assert.ok(!(other instanceof AiKeyError));
});
