const OpenAI = require("openai");
const { modelInfo } = require("../pricing");

const DEFAULT_MODEL = "gpt-4o-mini";
const PREFERRED = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "gpt-5-mini", "gpt-5", "gpt-5.4-mini", "gpt-5.4"];

// Retries are handled by the shared client wrapper.
function client(apiKey) {
  return new OpenAI({ apiKey, timeout: 120000, maxRetries: 0 });
}

function isReasoningFamily(model) {
  return /^(gpt-5|o\d)/i.test(model);
}

async function verifyKey(apiKey) {
  await client(apiKey).models.list();
  return { account: "" };
}

async function listModels(apiKey) {
  const page = await client(apiKey).models.list();
  const ids = (page.data || [])
    .map((m) => m.id)
    .filter((id) => /^(gpt-|o\d)/i.test(id))
    .filter((id) => !/(audio|realtime|transcribe|tts|image|search|instruct|-\d{4}-\d{2}-\d{2})/i.test(id));
  const rank = (id) => {
    const i = PREFERRED.indexOf(id);
    return i < 0 ? PREFERRED.length : i;
  };
  return [...new Set(ids)]
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    .map((id) => ({
      id,
      label: id,
      description: id === DEFAULT_MODEL ? "Recommended: fast and inexpensive" : "",
      ...modelInfo("openai", id),
    }));
}

function chatUsage(u) {
  if (!u) return null;
  const cached = u.prompt_tokens_details?.cached_tokens || 0;
  return {
    input: Math.max(0, (u.prompt_tokens || 0) - cached),
    output: u.completion_tokens || 0,
    cache_read: cached,
    cache_write: 0,
    total: u.total_tokens || (u.prompt_tokens || 0) + (u.completion_tokens || 0),
  };
}

function responsesUsage(u) {
  if (!u) return null;
  const cached = u.input_tokens_details?.cached_tokens || 0;
  return {
    input: Math.max(0, (u.input_tokens || 0) - cached),
    output: u.output_tokens || 0,
    cache_read: cached,
    cache_write: 0,
    total: u.total_tokens || (u.input_tokens || 0) + (u.output_tokens || 0),
  };
}

function reportSearches(response, onEvent) {
  if (!onEvent) return;
  for (const item of response.output || []) {
    const query = item.type === "web_search_call" ? item.action?.query : null;
    if (query) onEvent({ type: "search", text: String(query).slice(0, 200) });
  }
}

function createOpenAiProvider({ apiKey, model, onEvent }) {
  const api = client(apiKey);
  const chosen = model || DEFAULT_MODEL;
  return {
    async complete(prompt, { maxTokens = 1500 } = {}) {
      const params = {
        model: chosen,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
      };
      if (isReasoningFamily(chosen)) params.max_completion_tokens = maxTokens * 3;
      else Object.assign(params, { max_tokens: maxTokens, temperature: 0.3 });
      const res = await api.chat.completions.create(params);
      return { text: res.choices[0]?.message?.content || "", usage: chatUsage(res.usage) };
    },
    async search(prompt) {
      const run = (type) => api.responses.create({ model: chosen, tools: [{ type }], input: prompt });
      let res;
      try {
        res = await run("web_search");
      } catch (err) {
        if (err?.status !== 400) throw err;
        res = await run("web_search_preview");
      }
      reportSearches(res, onEvent);
      return { text: res.output_text || "", usage: responsesUsage(res.usage) };
    },
  };
}

module.exports = { verifyKey, listModels, createOpenAiProvider, DEFAULT_MODEL };
