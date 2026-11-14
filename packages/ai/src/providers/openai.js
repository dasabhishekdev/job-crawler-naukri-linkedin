const OpenAI = require("openai");

const DEFAULT_MODEL = "gpt-4o-mini";
const PREFERRED = ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1", "gpt-5-mini", "gpt-5", "gpt-5.4-mini", "gpt-5.4"];

function client(apiKey) {
  return new OpenAI({ apiKey, timeout: 120000, maxRetries: 2 });
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
    .map((id) => ({ id, label: id, description: id === DEFAULT_MODEL ? "Recommended: fast and inexpensive" : "" }));
}

function createOpenAiProvider({ apiKey, model }) {
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
      return res.choices[0]?.message?.content || "";
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
      return res.output_text || "";
    },
  };
}

module.exports = { verifyKey, listModels, createOpenAiProvider, DEFAULT_MODEL };
