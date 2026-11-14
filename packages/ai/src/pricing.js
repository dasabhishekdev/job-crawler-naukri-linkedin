// USD per 1M tokens (list prices, Nov 2026). `included` = covered by Cursor paid plans' weekly pool.
const PRICES = {
  cursor: {
    "composer-2.5": { input: 0.5, cache_read: 0.2, output: 2.5, included: true },
    "grok-4.5": { input: 2, cache_read: 0.5, output: 6, included: true },
    "grok-4.6": { input: 2, cache_read: 0.5, output: 6, included: true },
    "grok-4.7": { input: 2, cache_read: 0.5, output: 6, included: true },
    "claude-haiku-5-5": { input: 0.1, cache_read: 0.01, output: 0.5 },
    "claude-sonnet-5-5": { input: 2, cache_read: 0.1, output: 10 },
    "gemini-3-flash": { input: 0.5, cache_read: 0.05, output: 3 },
    "gemini-3.8-flash": { input: 0.75, cache_read: 0.075, output: 3.75 },
    "gpt-5.4-mini": { input: 0.75, cache_read: 0.075, output: 4.5 },
    "gpt-5.4-nano": { input: 0.2, cache_read: 0.02, output: 1.25 },
    "gpt-5.6-luna": { input: 0.2, cache_read: 0.02, output: 1.2 },
  },
  openai: {
    "gpt-4o-mini": { input: 0.15, cache_read: 0.075, output: 0.6 },
    "gpt-4o": { input: 2.5, cache_read: 1.25, output: 10 },
    "gpt-4.1-mini": { input: 0.4, cache_read: 0.1, output: 1.6 },
    "gpt-4.1": { input: 2, cache_read: 0.5, output: 8 },
    "gpt-5-mini": { input: 0.25, cache_read: 0.025, output: 2 },
    "gpt-5": { input: 1.25, cache_read: 0.125, output: 10 },
    "gpt-5.4-mini": { input: 0.75, cache_read: 0.075, output: 4.5 },
    "gpt-5.4": { input: 2.5, cache_read: 0.25, output: 15 },
  },
};

function modelInfo(provider, model) {
  const price = PRICES[provider]?.[model];
  return price
    ? { known: true, included_in_plan: Boolean(price.included), input: price.input, output: price.output }
    : { known: false, included_in_plan: false };
}

/** Upper-bound cost estimate at list price; `usd` is null for models without a known price. */
function estimateCost(provider, model, usage = {}) {
  const price = PRICES[provider]?.[model];
  if (!price) return { usd: null, included_in_plan: false };
  const usd =
    ((usage.input || 0) * price.input + (usage.cache_read || 0) * price.cache_read + (usage.output || 0) * price.output) /
    1_000_000;
  return { usd: Math.round(usd * 10000) / 10000, included_in_plan: Boolean(price.included) };
}

module.exports = { estimateCost, modelInfo, PRICES };
