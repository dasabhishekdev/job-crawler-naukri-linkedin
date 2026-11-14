const { User, Resume, Profile } = require("@jobportal/db");
const { aiForUser, PROVIDER_LABELS } = require("@jobportal/ai");

async function flagKeyError(user, err) {
  if (err?.name !== "AiKeyError" || !err.provider) return;
  await User.updateOne({ _id: user._id }, { $set: { [`ai.keys.${err.provider}.error`]: err.message.slice(0, 300) } });
}

function seconds(since) {
  return `${((Date.now() - since) / 1000).toFixed(1)}s`;
}

/** Wraps the AI client so every call shows up in the live run log with its purpose and duration. */
function instrumentAi(ai, log) {
  const who = `${PROVIDER_LABELS[ai.provider] || ai.provider} ${ai.model}`;
  async function call(method, prompt, opts = {}) {
    const label = opts.label || (method === "search" ? "Web search" : "AI task");
    await log.ai(`${label} · started with ${who}`);
    const started = Date.now();
    try {
      const result = await ai[method](prompt, opts);
      await log.ai(`${label} · done in ${seconds(started)}`);
      return result;
    } catch (err) {
      await log.warn(`${label} · failed after ${seconds(started)}: ${err.message}`);
      throw err;
    }
  }
  return { ...ai, json: (p, o) => call("json", p, o), search: (p, o) => call("search", p, o) };
}

/** Builds the user's instrumented AI client; a rejected key is flagged on the user so Settings can show it. */
async function withAi({ user, log }, fn) {
  try {
    const ai = aiForUser(user, {
      onEvent: (event) => {
        if (event.type === "search") log.search(`Searching the web: “${event.text}”`);
        else if (event.type === "narration") log.ai(event.text);
      },
    });
    return await fn(instrumentAi(ai, log));
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
