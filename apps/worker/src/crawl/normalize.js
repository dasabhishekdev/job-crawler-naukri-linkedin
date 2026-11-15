const { parsePostedAgeDays } = require("@jobportal/core");

const TRACKING_PARAMS = /^(utm_.*|ref|refid|src|source|trk|trackingid|gh_src|lever-source|lever-origin|from|fbclid|gclid|mc_cid|mc_eid)$/i;

const COMPANY_SUFFIXES =
  /\b(private limited|pvt\.? ltd\.?|pvt|limited|ltd\.?|inc\.?|llp|llc|corp\.?|corporation|co\.)(?=\s|$)/gi;

function normalizeUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || "").trim());
  } catch {
    return "";
  }
  if (!/^https?:$/.test(url.protocol)) return "";
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  for (const key of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.test(key)) url.searchParams.delete(key);
  }
  let out = url.toString();
  if (!url.search) out = out.replace(/\/+$/, "");
  else out = out.replace(/\/+\?/, "?");
  return out;
}

function slug(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeCompany(company) {
  return slug(String(company || "").replace(COMPANY_SUFFIXES, " ")).replace(/\bindia\b/g, "").trim();
}

function dedupeKey(company, title) {
  return `${normalizeCompany(company).replace(/\s+/g, " ")}|${slug(title)}`;
}

function isBlocked(company, blocklist = []) {
  const name = ` ${slug(company)} `;
  return blocklist.some((blocked) => {
    const b = slug(blocked);
    return b && name.includes(` ${b} `);
  });
}

const CITY_ALIASES = [
  ["bengaluru", "bangalore", "blr"],
  ["mumbai", "bombay", "navi mumbai", "thane"],
  ["delhi", "new delhi", "ncr", "delhi ncr", "gurgaon", "gurugram", "noida", "greater noida", "faridabad", "ghaziabad"],
  ["chennai", "madras"],
  ["kolkata", "calcutta"],
  ["hyderabad", "secunderabad"],
  ["pune", "pimpri chinchwad"],
  ["kochi", "cochin"],
  ["thiruvananthapuram", "trivandrum"],
  ["vadodara", "baroda"],
  ["mysuru", "mysore"],
];

function aliasesFor(target) {
  const city = slug(String(target || "").split(",")[0]);
  const group = CITY_ALIASES.find((g) => g.includes(city));
  return group || [city];
}

const REMOTE = /\b(remote|work from home|wfh|anywhere)\b/;
const COUNTRY_ONLY = /^(india|in|multiple locations|various locations|pan india)$/;

/** True when a posting's location fits the user's target cities (unknown or country-only locations pass). */
function matchesLocation(location, targets = [], remoteOk = false) {
  const loc = ` ${slug(location)} `;
  if (!targets.length || !loc.trim() || COUNTRY_ONLY.test(loc.trim())) return true;
  if (REMOTE.test(loc)) return remoteOk || targets.some((t) => REMOTE.test(slug(t)));
  return targets.some((t) => aliasesFor(t).some((alias) => alias && loc.includes(` ${alias} `)));
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

function decodeEntities(text) {
  return String(text || "").replace(/&(#\d+|#x[0-9a-f]+|[a-z0-9]+);/gi, (match, code) => {
    const lower = code.toLowerCase();
    if (ENTITIES[lower]) return ENTITIES[lower];
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
    if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)));
    return match;
  });
}

function htmlToText(html) {
  return decodeEntities(
    decodeEntities(String(html || ""))
      .replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, "\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, "")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function postedAgeDays(posted, now = new Date()) {
  const text = String(posted || "").trim();
  if (!text) return null;
  return parsePostedAgeDays(text, now);
}

module.exports = {
  postedAgeDays,
  normalizeUrl,
  normalizeCompany,
  dedupeKey,
  isBlocked,
  matchesLocation,
  htmlToText,
  slug,
};
