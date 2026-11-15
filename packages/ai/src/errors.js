const PROVIDER_LABELS = { cursor: "Cursor", openai: "OpenAI" };

class AiNotConfiguredError extends Error {
  constructor(message = "Add an AI provider key in Settings first.") {
    super(message);
    this.name = "AiNotConfiguredError";
  }
}

class AiKeyError extends Error {
  constructor(provider, detail = "") {
    super(`Your ${PROVIDER_LABELS[provider] || provider} key was rejected. Update it in Settings.${detail ? ` (${detail})` : ""}`);
    this.name = "AiKeyError";
    this.provider = provider;
  }
}

const AUTH_PATTERN = /(api key|apikey|unauthori[sz]ed|invalid.*key|key.*(expired|revoked|invalid)|permission_denied|authentication)/i;
const NETWORK_PATTERN = /fetch failed|network|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|UND_ERR|AbortError|timed out/i;

function classifyAiError(err, provider) {
  if (err instanceof AiKeyError || err instanceof AiNotConfiguredError) return err;
  const status = err?.status || err?.statusCode || err?.response?.status;
  const message = String(err?.message || err || "");
  if (status === 401 || status === 403 || AUTH_PATTERN.test(message)) {
    return new AiKeyError(provider, message.replace(/sk-[\w-]+/g, "sk-…").replace(/crsr_[\w-]+/g, "crsr_…").slice(0, 160));
  }
  if (NETWORK_PATTERN.test(message) || NETWORK_PATTERN.test(String(err?.cause?.code || ""))) {
    return new Error(`Could not reach ${PROVIDER_LABELS[provider] || provider}. Check outbound HTTPS from the server and try again.`);
  }
  return err instanceof Error ? err : new Error(String(err));
}

module.exports = { AiNotConfiguredError, AiKeyError, classifyAiError, PROVIDER_LABELS };
