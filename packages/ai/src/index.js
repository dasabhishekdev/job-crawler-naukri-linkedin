const cursor = require("./providers/cursor");
const openai = require("./providers/openai");
const { encryptSecret, decryptSecret, last4 } = require("./crypto");
const { extractJsonArray, extractJsonObject } = require("./json");
const { AiNotConfiguredError, AiKeyError, classifyAiError, PROVIDER_LABELS } = require("./errors");

const PROVIDERS = {
  cursor: { verifyKey: cursor.verifyKey, listModels: cursor.listModels, create: cursor.createCursorProvider, defaultModel: cursor.DEFAULT_MODEL },
  openai: { verifyKey: openai.verifyKey, listModels: openai.listModels, create: openai.createOpenAiProvider, defaultModel: openai.DEFAULT_MODEL },
};

function providerApi(provider) {
  const api = PROVIDERS[provider];
  if (!api) throw new Error(`Unknown AI provider: ${provider}`);
  return api;
}

async function wrap(provider, fn) {
  try {
    return await fn();
  } catch (err) {
    throw classifyAiError(err, provider);
  }
}

async function verifyProviderKey(provider, apiKey) {
  const api = providerApi(provider);
  return wrap(provider, async () => {
    const info = await api.verifyKey(apiKey);
    const models = await api.listModels(apiKey);
    return { ...info, models };
  });
}

async function listProviderModels(provider, apiKey) {
  return wrap(provider, () => providerApi(provider).listModels(apiKey));
}

/**
 * Unified AI client: `json(prompt)` returns a parsed object, `search(prompt)` returns
 * the text of a web-search-enabled answer. Errors are normalised (AiKeyError on auth failures).
 */
function createAi({ provider, apiKey, model }) {
  const api = providerApi(provider);
  const impl = api.create({ apiKey, model: model || api.defaultModel });
  return {
    provider,
    model: model || api.defaultModel,
    json: (prompt, opts) => wrap(provider, async () => extractJsonObject(await impl.complete(prompt, opts))),
    search: (prompt, opts) => wrap(provider, () => impl.search(prompt, opts)),
  };
}

function aiForUser(user) {
  const provider = user?.ai?.provider;
  const stored = provider && user.ai.keys?.[provider];
  if (!provider || !stored?.ciphertext) throw new AiNotConfiguredError();
  if (stored.error) throw new AiKeyError(provider, stored.error);
  return createAi({ provider, apiKey: decryptSecret(stored.ciphertext), model: user.ai.models?.[provider] });
}

function aiReady(user) {
  const provider = user?.ai?.provider;
  const stored = provider && user.ai.keys?.[provider];
  return Boolean(stored?.ciphertext && !stored.error);
}

module.exports = {
  PROVIDERS,
  PROVIDER_LABELS,
  createAi,
  aiForUser,
  aiReady,
  verifyProviderKey,
  listProviderModels,
  encryptSecret,
  decryptSecret,
  last4,
  extractJsonArray,
  extractJsonObject,
  AiNotConfiguredError,
  AiKeyError,
  classifyAiError,
};
