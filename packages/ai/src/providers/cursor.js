const fs = require("fs");
const os = require("os");
const path = require("path");
const { Agent, Cursor, CursorAgentError } = require("@cursor/sdk");
const { AiKeyError } = require("../errors");
const { createNarrator } = require("../narration");
const { modelInfo, PRICES } = require("../pricing");

const WEB_TOOLS = ["webSearch", "webFetch"];
const SEARCH_ONLY = ["webSearch"];
const DEFAULT_MODEL = "composer-2.5";

function workspaceDir() {
  const dir = path.join(process.env.DATA_DIR || os.tmpdir(), "cursor-agent");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cursorAuthHeaders(apiKey) {
  return { authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` };
}

async function verifyKey(apiKey) {
  let res;
  try {
    res = await fetch("https://api.cursor.com/v1/me", {
      headers: cursorAuthHeaders(apiKey),
      signal: AbortSignal.timeout(20000),
    });
  } catch (err) {
    throw Object.assign(new Error(err?.message || "fetch failed"), { cause: err });
  }
  if (res.status === 401 || res.status === 403) throw new AiKeyError("cursor", `HTTP ${res.status}`);
  if (!res.ok) throw new Error(`Cursor API returned HTTP ${res.status}`);
  const me = await res.json();
  return { account: me.userEmail || "" };
}

function fallbackModels() {
  return Object.keys(PRICES.cursor || {}).map((id) => ({
    id,
    label: id,
    description: id === DEFAULT_MODEL ? "Recommended" : "",
    ...modelInfo("cursor", id),
  }));
}

async function listModels(apiKey) {
  try {
    const models = await Cursor.models.list({ apiKey });
    if (models?.length) {
      return models.map((m) => ({ id: m.id, label: m.displayName || m.id, description: m.description || "", ...modelInfo("cursor", m.id) }));
    }
  } catch (err) {
    const status = err?.status || err?.statusCode;
    if (status === 401 || status === 403) throw err;
  }
  return fallbackModels();
}

function normalizeUsage(u) {
  if (!u) return null;
  return {
    input: u.inputTokens || 0,
    output: u.outputTokens || 0,
    cache_read: u.cacheReadTokens || 0,
    cache_write: u.cacheWriteTokens || 0,
    total: u.totalTokens || (u.inputTokens || 0) + (u.outputTokens || 0),
  };
}

/** Streams the agent's narration to `onEvent` while waiting for its final answer. */
async function streamNarration(run, onEvent) {
  const narrator = createNarrator((text) => onEvent({ type: "narration", text }));
  for await (const event of run.stream()) {
    if (event.type === "assistant") {
      for (const block of event.message?.content || []) {
        if (block.type === "text") narrator.push(block.text);
      }
    }
  }
  narrator.flush();
}

async function runAgent(prompt, { apiKey, model, tools, timeoutMs, onEvent }) {
  let agent;
  try {
    agent = await Agent.create({
      apiKey,
      model: { id: model || DEFAULT_MODEL },
      local: { cwd: workspaceDir() },
      tools,
    });
  } catch (err) {
    if (err instanceof CursorAgentError) throw Object.assign(new Error(err.message), { status: err.status });
    throw err;
  }

  let timer = null;
  try {
    const run = await agent.send(prompt);
    timer = setTimeout(() => {
      if (run.supports("cancel")) run.cancel().catch(() => {});
    }, timeoutMs);
    if (onEvent) await streamNarration(run, onEvent).catch(() => {});
    const result = await run.wait();
    if (result.status !== "finished") {
      throw new Error(`Cursor agent ${result.status}${result.error?.message ? `: ${result.error.message}` : ""}`);
    }
    return { text: String(result.result || ""), usage: normalizeUsage(result.usage) };
  } finally {
    if (timer) clearTimeout(timer);
    await agent[Symbol.asyncDispose]().catch(() => {});
  }
}

function createCursorProvider({ apiKey, model, onEvent }) {
  return {
    async complete(prompt, { timeoutMs = 4 * 60 * 1000 } = {}) {
      return runAgent(`${prompt}\n\nReply with the JSON only.`, { apiKey, model, tools: [], timeoutMs });
    },
    /** `deep: true` lets the agent open pages (webFetch); that costs ~10–50x more tokens than search alone. */
    async search(prompt, { timeoutMs, deep = false } = {}) {
      return runAgent(prompt, {
        apiKey,
        model,
        tools: deep ? WEB_TOOLS : SEARCH_ONLY,
        timeoutMs: timeoutMs ?? (deep ? 8 : 3) * 60 * 1000,
        onEvent,
      });
    },
  };
}

module.exports = { verifyKey, listModels, createCursorProvider, DEFAULT_MODEL };
