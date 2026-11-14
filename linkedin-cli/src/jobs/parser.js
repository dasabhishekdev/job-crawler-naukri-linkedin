function scoreJob(text, profile, keyword = null) {
  const lower = (text || "").toLowerCase();
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

  if (keyword) {
    const kw = keyword.toLowerCase();
    if (lower.includes(kw)) {
      score += 2;
      reasons.push(`keyword: ${keyword}`);
    }
    for (const part of kw.split(/\s+/)) {
      if (part.length > 2 && lower.includes(part)) {
        score += 1;
        reasons.push(`keyword-part: ${part}`);
      }
    }
  }

  return { score, reasons: [...new Set(reasons)] };
}

function analyzeJob(text, profile, keyword = null) {
  const { score, reasons } = scoreJob(text, profile, keyword);
  return { match_score: score, match_reasons: reasons };
}

module.exports = { analyzeJob, scoreJob };
