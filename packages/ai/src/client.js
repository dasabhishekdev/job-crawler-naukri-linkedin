const { extractJsonObject } = require("./json");
const { classifyAiError, AiKeyError } = require("./errors");
const { estimateCost } = require("./pricing");

const BACKOFF_MS = [2000, 6000];
const TRANSIENT_STATUS = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const TRANSIENT_TEXT = /(timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|socket hang up|network|temporar|overloaded|rate limit|try again)/i;

function isTransient(err) {
  if (err instanceof AiKeyError) return false;
  const status = err?.status || err?.statusCode;
  if (status) return TRANSIENT_STATUS.has(status);
  return TRANSIENT_TEXT.test(`${err?.code || ""} ${err?.message || ""}`);
}

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Adds retries, JSON repair and usage reporting around a provider implementation
 * whose `complete`/`search` resolve to `{ text, usage }`.
 */
function wrapProvider({ provider, model, impl, onUsage, sleep = realSleep }) {
  async function call(method, prompt, opts = {}) {
    for (let attempt = 0; ; attempt++) {
      const started = Date.now();
      try {
        const { text, usage } = await impl[method](prompt, opts);
        if (onUsage && usage) {
          const cost = estimateCost(provider, model, usage);
          onUsage({ provider, model, purpose: opts.label || method, usage, duration_ms: Date.now() - started, ...cost });
        }
        return text;
      } catch (raw) {
        const err = classifyAiError(raw, provider);
        if (attempt >= BACKOFF_MS.length || !isTransient(err)) throw err;
        await sleep(BACKOFF_MS[attempt]);
      }
    }
  }

  return {
    provider,
    model,
    async json(prompt, opts) {
      const text = await call("complete", prompt, opts);
      try {
        return extractJsonObject(text);
      } catch {
        const retry = await call(
          "complete",
          `${prompt}\n\nYour previous reply was not valid JSON. Reply with one valid JSON object only.`,
          opts
        );
        return extractJsonObject(retry);
      }
    },
    search: (prompt, opts) => call("search", prompt, opts),
  };
}

module.exports = { wrapProvider, isTransient };
