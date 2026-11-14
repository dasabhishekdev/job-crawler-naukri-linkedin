const DAY_MS = 24 * 60 * 60 * 1000;

function parsePostedAgeDays(postedText) {
  if (!postedText) return null;
  const text = postedText.toLowerCase().trim();

  if (text.includes("just now") || text.includes("today") || text.includes("few hours")) {
    return 0;
  }

  const dayMatch = text.match(/(\d+)\+?\s*day/);
  if (dayMatch) return Number(dayMatch[1]);

  const weekMatch = text.match(/(\d+)\+?\s*week/);
  if (weekMatch) return Number(weekMatch[1]) * 7;

  const monthMatch = text.match(/(\d+)\+?\s*month/);
  if (monthMatch) return Number(monthMatch[1]) * 30;

  if (text.includes("month")) return 30;
  if (text.includes("week")) return 7;

  return null;
}

function classifyFreshness(postedText, maxAgeDays = 14) {
  const ageDays = parsePostedAgeDays(postedText);
  if (ageDays === null) return { freshness: "unknown", age_days: null };
  if (ageDays > maxAgeDays) {
    return { freshness: "stale", age_days: ageDays };
  }
  return { freshness: "fresh", age_days: ageDays };
}

function isStale(postedText, maxAgeDays = 14) {
  return classifyFreshness(postedText, maxAgeDays).freshness === "stale";
}

module.exports = {
  parsePostedAgeDays,
  classifyFreshness,
  isStale,
  DAY_MS,
};
