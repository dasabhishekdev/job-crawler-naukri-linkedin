const { Profile, Resume } = require("@jobportal/db");
const { suggestionChanges } = require("@jobportal/core");
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

async function parseResumeTask({ user, run, log, stage }) {
  const { resume } = await loadResumeAndProfile(user);
  await Resume.updateOne({ _id: resume._id }, { $set: { parse_status: "parsing", parse_error: "" } });
  try {
    await stage("parse", "Reading your resume with AI");
    const parsed = normalizeParsed(await withAi({ user, log, run }, (ai) => ai.json(parsePrompt(resume.text), { maxTokens: 3500, label: "Reading your resume" })));

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
    profile.suggested = parsed.profile;
    profile.suggested_at = new Date();
    await profile.save();
    await Resume.updateOne({ _id: resume._id }, { $set: { parse_status: "done" } });

    const pending = suggestionChanges(profile.toObject(), parsed.profile);
    await log.info(`Profile ready: ${profile.target_roles.length} target roles, ${profile.skills.length} skills`);
    if (pending.length) {
      await log.info(`The analysis suggests changes to ${pending.map((c) => c.label.toLowerCase()).join(", ")}. Review and apply them on the Resume page.`);
    }
    return { target_roles: profile.target_roles.length, skills: profile.skills.length, suggested_changes: pending.length };
  } catch (err) {
    await Resume.updateOne({ _id: resume._id }, { $set: { parse_status: "failed", parse_error: err.message.slice(0, 300) } });
    throw err;
  }
}

module.exports = { parseResumeTask };
