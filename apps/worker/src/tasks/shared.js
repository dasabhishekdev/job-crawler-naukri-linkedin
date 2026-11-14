const { User, Resume, Profile } = require("@jobportal/db");
const { aiForUser } = require("@jobportal/ai");

async function flagKeyError(user, err) {
  if (err?.name !== "AiKeyError" || !err.provider) return;
  await User.updateOne({ _id: user._id }, { $set: { [`ai.keys.${err.provider}.error`]: err.message.slice(0, 300) } });
}

/** Builds the user's AI client; a rejected key is flagged on the user so Settings can show it. */
async function withAi(user, fn) {
  try {
    return await fn(aiForUser(user));
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

module.exports = { withAi, flagKeyError, loadResumeAndProfile };
