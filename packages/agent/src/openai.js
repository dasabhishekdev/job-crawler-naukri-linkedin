const OpenAI = require("openai");
const { buildChatCompletionParams, MODEL } = require("@jobportal/core");
const { recordOpenAiUsage } = require("./usage");
const { hydrateOpenAiEnv } = require("./settings");

async function getClient() {
  await hydrateOpenAiEnv();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey, timeout: 90000, maxRetries: 2 });
}

function getModel() {
  return process.env.OPENAI_MODEL || MODEL;
}

async function chatJson({ messages, maxTokens = 400, runId }) {
  const client = await getClient();
  if (!client) throw new Error("OPENAI_API_KEY not set");
  const response = await client.chat.completions.create(
    buildChatCompletionParams({
      model: getModel(),
      messages,
      maxTokens,
    })
  );
  await recordOpenAiUsage(runId, response);
  const raw = response.choices[0]?.message?.content?.trim() || "";
  if (!raw) throw new Error("OpenAI returned empty content");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const json = start >= 0 ? raw.slice(start, end + 1) : raw;
  return JSON.parse(json);
}

module.exports = { getClient, getModel, chatJson };
