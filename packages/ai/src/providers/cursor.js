const fs = require("fs");
const os = require("os");
const path = require("path");
const { Agent, Cursor, CursorAgentError } = require("@cursor/sdk");
const { AiKeyError } = require("../errors");

const WEB_TOOLS = ["webSearch", "webFetch"];
const DEFAULT_MODEL = "composer-2.5";

function workspaceDir() {
  const dir = path.join(process.env.DATA_DIR || os.tmpdir(), "cursor-agent");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function verifyKey(apiKey) {
  const res = await fetch("https://api.cursor.com/v1/me", {
    headers: { authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 401 || res.status === 403) throw new AiKeyError("cursor", `HTTP ${res.status}`);
  if (!res.ok) throw new Error(`Cursor API returned HTTP ${res.status}`);
  const me = await res.json();
  return { account: me.userEmail || "" };
}

async function listModels(apiKey) {
  const models = await Cursor.models.list({ apiKey });
  return models.map((m) => ({ id: m.id, label: m.displayName || m.id, description: m.description || "" }));
}

async function runAgent(prompt, { apiKey, model, tools, timeoutMs }) {
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
    const result = await run.wait();
    if (result.status !== "finished") {
      throw new Error(`Cursor agent ${result.status}${result.error?.message ? `: ${result.error.message}` : ""}`);
    }
    return String(result.result || "");
  } finally {
    if (timer) clearTimeout(timer);
    await agent[Symbol.asyncDispose]().catch(() => {});
  }
}

function createCursorProvider({ apiKey, model }) {
  return {
    async complete(prompt, { timeoutMs = 4 * 60 * 1000 } = {}) {
      return runAgent(`${prompt}\n\nReply with the JSON only.`, { apiKey, model, tools: [], timeoutMs });
    },
    async search(prompt, { timeoutMs = 8 * 60 * 1000 } = {}) {
      return runAgent(prompt, { apiKey, model, tools: WEB_TOOLS, timeoutMs });
    },
  };
}

module.exports = { verifyKey, listModels, createCursorProvider, DEFAULT_MODEL };
