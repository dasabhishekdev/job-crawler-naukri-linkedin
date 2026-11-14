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

function extractJsonArray(text) {
  const raw = String(text || "").replace(/```(?:json)?/gi, "");
  const candidates = [];
  const arrStart = raw.indexOf("[");
  const arrEnd = raw.lastIndexOf("]");
  const objStart = raw.indexOf("{");
  const objEnd = raw.lastIndexOf("}");
  if (objStart >= 0 && (arrStart < 0 || objStart < arrStart) && objEnd > objStart) {
    candidates.push(raw.slice(objStart, objEnd + 1));
  }
  if (arrStart >= 0 && arrEnd > arrStart) candidates.push(raw.slice(arrStart, arrEnd + 1));

  for (const chunk of candidates) {
    try {
      const parsed = JSON.parse(chunk);
      if (Array.isArray(parsed)) return parsed;
      for (const key of ["jobs", "results", "items", "postings"]) {
        if (Array.isArray(parsed?.[key])) return parsed[key];
      }
    } catch {
      /* try the next candidate */
    }
  }
  return [];
}

function extractJsonObject(text) {
  const raw = String(text || "").replace(/```(?:json)?/gi, "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No JSON object in model output");
  return JSON.parse(raw.slice(start, end + 1));
}

function isBlocked(company, blocklist = []) {
  const name = ` ${slug(company)} `;
  return blocklist.some((blocked) => {
    const b = slug(blocked);
    return b && name.includes(` ${b} `);
  });
}

function isBengaluru(location) {
  const loc = String(location || "").trim();
  if (!loc) return true;
  return /(bangalore|bengaluru|karnataka)/i.test(loc);
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
  const relative = parsePostedAgeDays(text);
  if (relative !== null) return relative;
  const ts = Date.parse(text);
  if (Number.isNaN(ts)) return null;
  return Math.max(0, Math.floor((now.getTime() - ts) / 86400000));
}

module.exports = {
  postedAgeDays,
  normalizeUrl,
  normalizeCompany,
  dedupeKey,
  extractJsonArray,
  extractJsonObject,
  isBlocked,
  isBengaluru,
  htmlToText,
  slug,
};
