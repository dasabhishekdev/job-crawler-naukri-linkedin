const OpenAI = require("openai");
const { AppSettings } = require("@jobportal/db");

const RECOMMENDED_MODEL = "gpt-4o";

const MODEL_CATALOG = [
  {
    id: "gpt-4o",
    label: "GPT-4o",
    tag: "Recommended",
    blurb: "Best fit for this agent: ranking, headlines, and Naukri form answers.",
  },
  {
    id: "gpt-4.1",
    label: "GPT-4.1",
    tag: "Stronger",
    blurb: "Better instruction-following when your account has it.",
  },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    tag: "Cheaper",
    blurb: "Fast and inexpensive. Fine for search queries.",
  },
  {
    id: "gpt-4.1-mini",
    label: "GPT-4.1 mini",
    tag: "Cheaper",
    blurb: "Lower-cost 4.1 variant for lighter tasks.",
  },
  {
    id: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    tag: "Latest",
    blurb: "Use if this premium key already targets the GPT-5 family.",
  },
  {
    id: "gpt-5.4",
    label: "GPT-5.4",
    tag: "Latest",
    blurb: "Full GPT-5.4 when the account exposes it.",
  },
  {
    id: "gpt-5-mini",
    label: "GPT-5 mini",
    tag: "Latest",
    blurb: "Smaller GPT-5 chat model when available.",
  },
  {
    id: "o4-mini",
    label: "o4-mini",
    tag: "Reasoning",
    blurb: "Reasoning model. Slower and usually more expensive.",
  },
];

function maskKey(key) {
  const value = String(key || "");
  if (!value) return "";
  if (value.length < 12) return "••••••••";
  return `${value.slice(0, 7)}…${value.slice(-4)}`;
}

function stripSecrets(text) {
  return String(text || "").replace(/sk-[a-zA-Z0-9_-]+/g, "sk-…");
}

function friendlyOpenAiError(err) {
  const status = err?.status || err?.statusCode;
  const msg = stripSecrets(err?.message || String(err));
  if (status === 401) return "OpenAI rejected this API key. It is invalid or revoked.";
  if (status === 403) return "This key does not have access to that model.";
  if (status === 429) return "OpenAI rate-limited this key. Try again in a minute.";
  return msg;
}

function assertKeyFormat(key) {
  const value = String(key || "").trim();
  if (!value.startsWith("sk-") || value.length < 20) {
    throw new Error("That does not look like an OpenAI API key. It should start with sk-");
  }
  return value;
}

function allowedModel(model) {
  const id = String(model || "").trim();
  if (MODEL_CATALOG.some((item) => item.id === id)) return id;
  if (/^[\w.-]{3,64}$/.test(id)) return id;
  return RECOMMENDED_MODEL;
}

function isChatModelId(id) {
  if (!id) return false;
  if (/(embed|whisper|tts|dall-e|image|audio|transcribe|moderation|realtime|search)/i.test(id)) {
    return false;
  }
  return /^(gpt-|o\d|chatgpt-)/i.test(id);
}

function rankAvailableModels(ids) {
  const set = new Set((ids || []).filter(Boolean));
  const ranked = [];
  const seen = new Set();

  for (const item of MODEL_CATALOG) {
    const match =
      set.has(item.id) ||
      [...set].find((id) => id === item.id || id.startsWith(`${item.id}-`));
    if (!match) continue;
    const id = set.has(item.id) ? item.id : match;
    if (seen.has(id)) continue;
    seen.add(id);
    ranked.push({ ...item, id });
  }

  const extras = [...set]
    .filter((id) => isChatModelId(id) && !seen.has(id))
    .filter((id) => !/instruct/i.test(id) && !/-\d{4}/.test(id))
    .sort()
    .slice(0, 6)
    .map((id) => ({
      id,
      label: id,
      tag: "Available",
      blurb: "This model is on the account. Prefer GPT-4o when it is listed.",
    }));

  return ranked.concat(extras);
}

function pickRecommended(models) {
  if (!models?.length) return RECOMMENDED_MODEL;
  const preferred = models.find((item) => item.id === RECOMMENDED_MODEL);
  return (preferred || models[0]).id;
}

function pingParams(model) {
  const params = {
    model,
    messages: [{ role: "user", content: "Reply with the word ok" }],
  };
  if (/gpt-5/i.test(model) || /^o\d/i.test(model)) {
    params.max_completion_tokens = 16;
  } else {
    params.max_tokens = 16;
  }
  return params;
}

async function storedOpenAiDoc() {
  return AppSettings.findById("openai").lean();
}

async function resolveApiKey(incoming) {
  if (incoming) return assertKeyFormat(incoming);
  const doc = await storedOpenAiDoc();
  const key = doc?.api_key || process.env.OPENAI_API_KEY || "";
  if (!key) throw new Error("Paste an OpenAI API key first.");
  return assertKeyFormat(key);
}

async function callOpenAiWithKey(apiKey) {
  const client = new OpenAI({ apiKey, timeout: 25000, maxRetries: 0 });
  let listed;
  try {
    listed = await client.models.list();
  } catch (err) {
    throw new Error(friendlyOpenAiError(err));
  }

  const ids = (listed?.data || []).map((item) => item.id);
  const models = rankAvailableModels(ids);
  if (!models.length) {
    throw new Error("This key works, but no chat models were returned. Check the account’s model access.");
  }

  const probeModel = pickRecommended(models);
  try {
    const ping = await client.chat.completions.create(pingParams(probeModel));
    const text = ping?.choices?.[0]?.message?.content || "";
    if (!String(text).trim()) {
      throw new Error(`OpenAI returned an empty reply from ${probeModel}.`);
    }
  } catch (err) {
    throw new Error(
      `Key listed models, but calling ${probeModel} failed: ${friendlyOpenAiError(err)}`
    );
  }

  return { models, probeModel };
}

async function persistOpenAi({ apiKey, model, availableModels, verifiedAt, lastVerifiedModel }) {
  const current = await storedOpenAiDoc();
  const nextKey = apiKey || current?.api_key || process.env.OPENAI_API_KEY || "";
  const nextModel = allowedModel(model || current?.model || RECOMMENDED_MODEL);
  const payload = {
    api_key: nextKey,
    model: nextModel,
  };
  if (availableModels) payload.available_models = availableModels;
  if (verifiedAt !== undefined) payload.verified_at = verifiedAt;
  if (lastVerifiedModel !== undefined) payload.last_verified_model = lastVerifiedModel;

  await AppSettings.findByIdAndUpdate("openai", { $set: payload }, { upsert: true, new: true, setDefaultsOnInsert: true });
  if (nextKey) process.env.OPENAI_API_KEY = nextKey;
  process.env.OPENAI_MODEL = nextModel;
  return getPublicOpenAiSettingsFromDoc();
}

async function hydrateOpenAiEnv() {
  const doc = await storedOpenAiDoc();
  if (doc?.api_key) process.env.OPENAI_API_KEY = doc.api_key;
  if (doc?.model) process.env.OPENAI_MODEL = doc.model;
  if (!process.env.OPENAI_MODEL) process.env.OPENAI_MODEL = RECOMMENDED_MODEL;
  return getPublicOpenAiSettingsFromDoc(doc);
}

async function getPublicOpenAiSettings() {
  return getPublicOpenAiSettingsFromDoc();
}

async function getPublicOpenAiSettingsFromDoc(docArg) {
  const doc = docArg || (await storedOpenAiDoc());
  const key = doc?.api_key || process.env.OPENAI_API_KEY || "";
  const models = Array.isArray(doc?.available_models) && doc.available_models.length
    ? doc.available_models
    : MODEL_CATALOG;
  return {
    configured: Boolean(key),
    verified: Boolean(doc?.verified_at && key),
    verified_at: doc?.verified_at || null,
    masked_key: maskKey(key),
    model: doc?.model || process.env.OPENAI_MODEL || RECOMMENDED_MODEL,
    recommended_model: RECOMMENDED_MODEL,
    last_verified_model: doc?.last_verified_model || "",
    models,
  };
}

async function checkOpenAiKey({ apiKey } = {}) {
  const key = await resolveApiKey(apiKey);
  const { models, probeModel } = await callOpenAiWithKey(key);
  const recommended = pickRecommended(models);
  const current = await storedOpenAiDoc();
  const nextModel = models.some((item) => item.id === current?.model) ? current.model : recommended;

  const saved = await persistOpenAi({
    apiKey: key,
    model: nextModel,
    availableModels: models,
    verifiedAt: new Date(),
    lastVerifiedModel: probeModel,
  });

  return {
    ...saved,
    verified: true,
    probe_model: probeModel,
    recommended_model: recommended,
    models,
    message: `Key works. ${probeModel} responded. Choose a model, then save it for the agent.`,
  };
}

async function saveOpenAiSettings({ apiKey, model }) {
  const current = await storedOpenAiDoc();
  const key = apiKey ? assertKeyFormat(apiKey) : current?.api_key || process.env.OPENAI_API_KEY || "";
  if (!key) throw new Error("Check an OpenAI API key first.");
  if (!current?.verified_at && !apiKey) {
    throw new Error("Check the API key before saving a model.");
  }

  const chosen = allowedModel(model);
  const known = current?.available_models || [];
  if (known.length && !known.some((item) => (item.id || item) === chosen)) {
    throw new Error(`${chosen} was not returned for this key. Check the key again.`);
  }

  const client = new OpenAI({ apiKey: key, timeout: 25000, maxRetries: 0 });
  try {
    const ping = await client.chat.completions.create(pingParams(chosen));
    const text = ping?.choices?.[0]?.message?.content || "";
    if (!String(text).trim()) {
      throw new Error(`OpenAI returned an empty reply from ${chosen}.`);
    }
  } catch (err) {
    throw new Error(`Could not use ${chosen} with this key: ${friendlyOpenAiError(err)}`);
  }

  const saved = await persistOpenAi({
    apiKey: key,
    model: chosen,
    availableModels: known.length ? known : undefined,
    verifiedAt: new Date(),
    lastVerifiedModel: chosen,
  });

  return {
    ...saved,
    verified: true,
    message: `Agent will use ${chosen}.`,
  };
}

module.exports = {
  RECOMMENDED_MODEL,
  MODEL_CATALOG,
  maskKey,
  hydrateOpenAiEnv,
  getPublicOpenAiSettings,
  getPublicOpenAiSettingsFromDoc,
  checkOpenAiKey,
  saveOpenAiSettings,
};
