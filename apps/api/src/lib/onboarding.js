const { Profile, Resume } = require("@jobportal/db");
const { aiReady } = require("@jobportal/ai");

async function onboardingStatus(user) {
  const [resume, profile] = await Promise.all([
    Resume.findOne({ user_id: user._id, is_current: true }, "parse_status").lean(),
    Profile.findOne({ user_id: user._id }, "target_roles").lean(),
  ]);
  const steps = {
    resume: Boolean(resume),
    ai: aiReady(user),
    profile: Boolean(profile?.target_roles?.length),
  };
  return { ...steps, complete: steps.resume && steps.ai && steps.profile, resume_parse_status: resume?.parse_status || null };
}

module.exports = { onboardingStatus };
