const { detectBoard } = require("./career-boards");
const { normalizeUrl, slug } = require("./normalize");

/** Job boards / aggregators that mirror employer postings — prefer the company's own careers page. */
const AGGREGATOR_HOSTS = [
  "apna.co",
  "apna.app",
  "naukri.com",
  "naukimg.com",
  "indeed.com",
  "linkedin.com",
  "glassdoor.co.in",
  "glassdoor.com",
  "shine.com",
  "foundit.in",
  "monsterindia.com",
  "monster.com",
  "timesjobs.com",
  "hirist.com",
  "hirist.tech",
  "instahyre.com",
  "cutshort.io",
  "iimjobs.com",
  "angel.co",
  "wellfound.com",
  "internshala.com",
  "workindia.in",
  "quikr.com",
  "olx.in",
  "facebook.com",
  "instagram.com",
];

const ATS_HINT =
  /(greenhouse\.io|lever\.co|ashbyhq\.com|myworkdayjobs\.com|myworkdaysite\.com|smartrecruiters\.com|darwinbox\.(in|com)|keka\.com|freshteam\.com|recruitee\.com|jobvite\.com|bamboohr\.com|icims\.com|successfactors\.com|taleo\.net|workable\.com|teamtailor\.com|personio\.(de|com)|ripplehire\.com|zohorecruit\.com)/i;

const OFFICIAL_APPLY_TEXT =
  /apply\s+(on|at|via)?\s*(company|employer|official|careers?)|company\s+(website|site|careers?)|official\s+(website|careers?|posting)|view\s+(on|at)\s+company|go\s+to\s+company/i;

function hostOf(raw) {
  try {
    return new URL(String(raw || "")).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function matchesHost(host, listed) {
  if (!host) return false;
  return listed.some((h) => host === h || host.endsWith(`.${h}`));
}

function isAggregatorUrl(raw) {
  return matchesHost(hostOf(raw), AGGREGATOR_HOSTS);
}

function isAtsUrl(raw) {
  const host = hostOf(raw);
  if (!host) return false;
  if (ATS_HINT.test(host)) return true;
  return detectBoard(raw).type !== "generic";
}

/** Classifies a job URL: company careers / ATS beat aggregators for authenticity. */
function classifyJobUrl(raw) {
  const host = hostOf(raw);
  if (!host) return { kind: "unknown", host: "" };
  if (isAggregatorUrl(raw)) return { kind: "aggregator", host };
  if (isAtsUrl(raw)) return { kind: "ats", host };
  if (/(^|\.)(careers?|jobs|join|hiring)\./i.test(host) || /\/(careers?|jobs|openings|positions|apply)\b/i.test(String(raw))) {
    return { kind: "company", host };
  }
  return { kind: "unknown", host };
}

function isGenuineUrl(raw) {
  const kind = classifyJobUrl(raw).kind;
  return kind === "ats" || kind === "company";
}

function scoreSourceUrl(raw) {
  const kind = classifyJobUrl(raw).kind;
  if (kind === "ats") return 3;
  if (kind === "company") return 2;
  if (kind === "aggregator") return 0;
  return 1;
}

/** Pulls likely employer apply / careers links out of an aggregator job page. */
function extractOfficialApplyUrl(html, pageUrl) {
  const base = String(pageUrl || "");
  const pageHost = hostOf(base);
  let best = { score: 0, url: "" };

  for (const m of String(html || "").matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try {
      url = new URL(m[1], base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol)) continue;
    const href = normalizeUrl(url.href);
    if (!href || isAggregatorUrl(href)) continue;
    const linkHost = hostOf(href);
    if (!linkHost || linkHost === pageHost) continue;

    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    let score = 0;
    if (isAtsUrl(href)) score += 5;
    if (OFFICIAL_APPLY_TEXT.test(text) || OFFICIAL_APPLY_TEXT.test(href)) score += 4;
    if (/\/(job|jobs|career|careers|opening|position|apply)\b/i.test(url.pathname)) score += 2;
    if (/(careers?|jobs)\./i.test(linkHost)) score += 2;
    if (score > best.score) best = { score, url: href };
  }

  // Canonical / og:url sometimes points at the employer posting.
  for (const pattern of [
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
  ]) {
    const href = normalizeUrl(html?.match?.(pattern)?.[1] || "");
    if (href && !isAggregatorUrl(href) && scoreSourceUrl(href) > best.score) best = { score: scoreSourceUrl(href), url: href };
  }

  return best.score >= 2 ? best.url : "";
}

/** Best-effort homepage guess for short brand names only (Flipkart → flipkart.com). */
function guessCompanyWebsite(company) {
  const words = slug(company).split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 2) return "";
  if (words.some((w) => w.length < 3)) return "";
  return `https://www.${words.join("")}.com`;
}

/** Unique employer names found on aggregator listings — used to seed career-page crawls. */
function companiesFromAggregatorJobs(jobs) {
  const seen = new Set();
  const out = [];
  for (const job of jobs || []) {
    const url = job.job_url || job.apply_url || job.url || "";
    if (!isAggregatorUrl(url)) continue;
    const name = String(job.company || "").trim().slice(0, 80);
    const key = slug(name);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({
      name,
      website: guessCompanyWebsite(name),
      careers_url: "",
      why: `Seen on ${hostOf(url) || "a job board"} — looking up official careers`,
    });
  }
  return out;
}

/** Keeps genuine postings; drops aggregator mirrors when the same company+title already has a company/ATS URL. */
function preferGenuineJobs(jobs) {
  const bestByKey = new Map();
  for (const job of jobs || []) {
    const key = `${slug(job.company)}|${slug(job.title)}`;
    const prev = bestByKey.get(key);
    if (!prev || scoreSourceUrl(job.job_url || job.apply_url) > scoreSourceUrl(prev.job_url || prev.apply_url)) {
      bestByKey.set(key, job);
    }
  }
  return [...bestByKey.values()];
}

module.exports = {
  AGGREGATOR_HOSTS,
  isAggregatorUrl,
  isAtsUrl,
  isGenuineUrl,
  classifyJobUrl,
  scoreSourceUrl,
  extractOfficialApplyUrl,
  companiesFromAggregatorJobs,
  preferGenuineJobs,
  guessCompanyWebsite,
};
