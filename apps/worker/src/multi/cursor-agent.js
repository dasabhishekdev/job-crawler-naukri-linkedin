const fs = require("fs");
const path = require("path");
const { Agent, CursorAgentError } = require("@cursor/sdk");

const WEB_TOOLS = ["webSearch", "webFetch"];

function agentWorkspace() {
  const dir = path.join(process.env.DATA_DIR || "./data", "cursor-agent");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cursorConfigured() {
  return Boolean(process.env.CURSOR_API_KEY);
}

/**
 * Runs one Cursor agent turn and returns its final text.
 * `tools` defaults to web search/fetch only; pass [] for text-only reasoning.
 */
async function runCursorAgent(prompt, { tools = WEB_TOOLS, timeoutMs = 8 * 60 * 1000, log } = {}) {
  const apiKey = process.env.CURSOR_API_KEY;
  if (!apiKey) throw new Error("CURSOR_API_KEY is not set");

  const agent = await Agent.create({
    apiKey,
    model: { id: process.env.CURSOR_MODEL || "composer-2.5" },
    local: { cwd: agentWorkspace() },
    tools,
  });

  let timer = null;
  try {
    const run = await agent.send(prompt);
    if (log) await log.info(`Cursor agent run ${run.id} started`, { agent_id: agent.agentId });
    timer = setTimeout(() => {
      if (run.supports("cancel")) run.cancel().catch(() => {});
    }, timeoutMs);
    const result = await run.wait();
    if (result.status !== "finished") {
      throw new Error(`Cursor agent ${result.status}: ${result.error?.message || "no result"}`);
    }
    return String(result.result || "");
  } catch (err) {
    if (err instanceof CursorAgentError) {
      throw new Error(`Cursor agent could not start: ${err.message}`);
    }
    throw err;
  } finally {
    if (timer) clearTimeout(timer);
    await agent[Symbol.asyncDispose]().catch(() => {});
  }
}

module.exports = { runCursorAgent, cursorConfigured, WEB_TOOLS };
