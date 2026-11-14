const JOB_SIGNALS = [
  "hiring",
  "we're hiring",
  "we are hiring",
  "job opening",
  "open position",
  "open role",
  "looking for",
  "immediate joiner",
  "join our team",
  "send your resume",
  "send resume",
  "share your resume",
  "apply now",
  "dm me",
  "drop your cv",
  "drop cv",
  "referral",
  "referrals",
  "vacancy",
  "vacancies",
  "opening for",
  "role open",
  "actively hiring",
  "walk-in",
  "walk in",
  "interested candidates",
  "email your resume",
  "mail your resume",
  "hr@",
  "careers@",
  "talent@",
  "recruitment",
  "job opportunity",
  "we need",
  "urgent requirement",
];

function isJobOpeningPost(text) {
  const lower = text.toLowerCase();
  return JOB_SIGNALS.some((signal) => lower.includes(signal));
}

function scorePost(text, profile) {
  const lower = text.toLowerCase();
  const reasons = [];
  let score = 0;

  for (const role of profile.target_roles) {
    if (lower.includes(role)) {
      score += 3;
      reasons.push(`role: ${role}`);
    }
  }

  for (const skill of profile.skills) {
    if (lower.includes(skill)) {
      score += 1;
      reasons.push(`skill: ${skill}`);
    }
  }

  for (const location of profile.locations) {
    if (lower.includes(location)) {
      score += 2;
      reasons.push(`location: ${location}`);
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  return { score, reasons: uniqueReasons };
}

function analyzePost(text, profile) {
  const isJobPost = isJobOpeningPost(text);
  const { score, reasons } = scorePost(text, profile);

  return {
    is_job_post: isJobPost,
    match_score: score,
    match_reasons: reasons,
  };
}

module.exports = { analyzePost, isJobOpeningPost, scorePost };
