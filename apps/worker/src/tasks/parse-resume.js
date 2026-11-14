const { Profile, Resume } = require("@jobportal/db");
const { parsePrompt, normalizeParsed } = require("../resume/parse");
const { withAi, loadResumeAndProfile } = require("./shared");

const PROFILE_FIELDS = [
  "full_name",
  "email",
  "phone",
  "current_location",
  "headline",
  "summary",
  "experience_years",
  "skills",
  "target_roles",
  "target_locations",
];

function isEmpty(value) {
  return value === undefined || value === null || value === "" || value === 0 || (Array.isArray(value) && !value.length);
}

async function parseResumeTask({ user, log, stage }) {
  const { resume } = await loadResumeAndProfile(user);
  await Resume.updateOne({ _id: resume._id }, { $set: { parse_status: "parsing", parse_error: "" } });
  try {
    await stage("parse", "Reading your resume with AI");
    const parsed = normalizeParsed(await withAi(user, (ai) => ai.json(parsePrompt(resume.text), { maxTokens: 3500 })));

    const profile = (await Profile.findOne({ user_id: user._id })) || new Profile({ user_id: user._id });
    profile.structured_resume = parsed.resume;
    for (const field of PROFILE_FIELDS) {
      const next = parsed.profile[field];
      if (isEmpty(next)) continue;
      if (!profile.edited_by_user || isEmpty(profile[field])) profile[field] = next;
    }
    if (!profile.target_locations.length && profile.current_location) {
      profile.target_locations = [profile.current_location.split(",")[0].trim()];
    }
    await profile.save();
    await Resume.updateOne({ _id: resume._id }, { $set: { parse_status: "done" } });
    await log.info(`Profile ready: ${profile.target_roles.length} target roles, ${profile.skills.length} skills`);
    return { target_roles: profile.target_roles.length, skills: profile.skills.length };
  } catch (err) {
    await Resume.updateOne({ _id: resume._id }, { $set: { parse_status: "failed", parse_error: err.message.slice(0, 300) } });
    throw err;
  }
}

module.exports = { parseResumeTask };
