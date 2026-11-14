const { User, Resume, Profile, AiUsage } = require("@jobportal/db");
const { aiForUser, PROVIDER_LABELS } = require("@jobportal/ai");
const { budgetForUser } = require("../budget");

async function flagKeyError(user, err) {
  if (err?.name !== "AiKeyError" || !err.provider) return;
  await User.updateOne({ _id: user._id }, { $set: { [`ai.keys.${err.provider}.error`]: err.message.slice(0, 300) } });
}

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(u) {
  if (u.included_in_plan) return "included in Cursor plan";
  return u.usd === null || u.usd === undefined ? "" : `≈ $${u.usd.toFixed(4)}`;
}

/** Wraps the AI client so every call is budget-checked and shows up in the live run log. */
function instrumentAi(ai, log, budget) {
  const who = `${PROVIDER_LABELS[ai.provider] || ai.provider} ${ai.model}`;
  async function call(method, prompt, opts = {}) {
    const label = opts.label || (method === "search" ? "Web search" : "AI task");
    const estimate = opts.estimate ?? (method === "search" ? (opts.deep ? 600_000 : 60_000) : 15_000);
    budget?.check(estimate, opts.reserve || 0);
    await log.ai(`${label} · started with ${who}`);
    const started = Date.now();
    try {
      return await ai[method](prompt, opts);
    } catch (err) {
      await log.warn(`${label} · failed after ${seconds(Date.now() - started)}: ${err.message}`);
      throw err;
    }
  }
  return { ...ai, json: (p, o) => call("json", p, o), search: (p, o) => call("search", p, o) };
}

/**
 * Builds the user's metered AI client for a run. Usage is stored in `ai_usage`, counted against
 * the daily token budget, and logged; a rejected key is flagged on the user for Settings.
 */
async function withAi({ user, log, run }, fn) {
  const budget = await budgetForUser(user);
  try {
    const ai = aiForUser(user, {
      onEvent: (event) => {
        if (event.type === "search") log.search(`Searching the web: “${event.text}”`);
        else if (event.type === "narration") log.ai(event.text);
      },
      onUsage: (u) => {
        budget.add(u.usage.total);
        const cost = formatCost(u);
        log.ai(`${u.purpose} · done in ${seconds(u.duration_ms)} · ${u.usage.total.toLocaleString("en-US")} tokens${cost ? ` · ${cost}` : ""}`);
        AiUsage.create({
          user_id: user._id,
          run_id: run?._id,
          provider: u.provider,
          model: u.model,
          purpose: String(u.purpose).slice(0, 120),
          input_tokens: u.usage.input,
          output_tokens: u.usage.output,
          cache_read_tokens: u.usage.cache_read,
          cache_write_tokens: u.usage.cache_write,
          total_tokens: u.usage.total,
          duration_ms: u.duration_ms,
          est_cost_usd: u.usd,
          included_in_plan: u.included_in_plan,
        }).catch(() => {});
      },
    });
    return await fn(instrumentAi(ai, log, budget), budget);
  } catch (err) {
    await flagKeyError(user, err);
    throw err;
  }
}

async function loadResumeAndProfile(user) {
  const [resume, profile] = await Promise.all([
    Resume.findOne({ user_id: user._id, is_current: true }).sort("-createdAt"),
    Profile.findOne({ user_id: user._id }),
  ]);
  if (!resume) throw new Error("Upload your resume first.");
  return { resume, profile };
}

module.exports = { withAi, instrumentAi, flagKeyError, loadResumeAndProfile };
