const DAY_MS = 24 * 60 * 60 * 1000;

function parsePostedAgeDays(postedText, now = new Date()) {
  if (!postedText) return null;
  const text = postedText.toLowerCase().trim();

  if (/\b(just now|today|few hours|hour ago|hours ago|minutes? ago)\b/.test(text)) {
    return 0;
  }
  if (/\byesterday\b/.test(text)) return 1;

  const hourMatch = text.match(/(\d+)\+?\s*hours?\b/);
  if (hourMatch) return 0;

  const dayMatch = text.match(/(\d+)\+?\s*days?\b/);
  if (dayMatch) return Number(dayMatch[1]);

  const weekMatch = text.match(/(\d+)\+?\s*weeks?\b/);
  if (weekMatch) return Number(weekMatch[1]) * 7;

  const monthMatch = text.match(/(\d+)\+?\s*months?\b/);
  if (monthMatch) return Number(monthMatch[1]) * 30;

  const yearMatch = text.match(/(\d+)\+?\s*years?\b/);
  if (yearMatch) return Number(yearMatch[1]) * 365;

  if (/\bmonth\b/.test(text) && !/\d/.test(text)) return 30;
  if (/\bweek\b/.test(text) && !/\d/.test(text)) return 7;

  const ts = Date.parse(postedText);
  if (!Number.isNaN(ts)) {
    return Math.max(0, Math.floor((now.getTime() - ts) / DAY_MS));
  }

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
