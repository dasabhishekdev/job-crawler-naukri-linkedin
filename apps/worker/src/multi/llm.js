const { chatJson } = require("@jobportal/agent");
const { runCursorAgent, cursorConfigured } = require("./cursor-agent");
const { extractJsonObject } = require("./normalize");

function llmEngine() {
  if (process.env.OPENAI_API_KEY) return "openai";
  if (cursorConfigured()) return "cursor";
  return null;
}

/** JSON-object completion: OpenAI when a key is configured, otherwise a tool-less Cursor agent. */
async function llmJson(prompt, { maxTokens = 800, runId } = {}) {
  const engine = llmEngine();
  switch (engine) {
    case "openai":
      return chatJson({ runId, maxTokens, messages: [{ role: "user", content: prompt }] });
    case "cursor":
      return extractJsonObject(await runCursorAgent(`${prompt}\n\nReply with the JSON object only.`, { tools: [] }));
    case null:
      throw new Error("No AI engine configured: set OPENAI_API_KEY or CURSOR_API_KEY");
    default: {
      const unknown = engine;
      throw new Error(`Unknown AI engine: ${unknown}`);
    }
  }
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

module.exports = { llmJson, llmEngine, mapLimit };
