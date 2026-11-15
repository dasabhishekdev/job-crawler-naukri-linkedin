const { extractJsonArray } = require("@jobportal/ai");

const SECOND_LEVEL = new Set(["co", "com", "org", "net", "gov", "ac", "edu", "firm", "gen", "ind", "ltd"]);
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function registrableDomain(rawUrl) {
  let host;
  try {
    host = new URL(rawUrl).hostname.toLowerCase();
  } catch {
    return "";
  }
  const parts = host.split(".");
  if (parts.length <= 2) return host;
  const tld = parts[parts.length - 1];
  const sld = parts[parts.length - 2];
  return tld.length === 2 && SECOND_LEVEL.has(sld) ? parts.slice(-3).join(".") : parts.slice(-2).join(".");
}

/** Cleans AI company suggestions: valid https URLs, no duplicates, nothing already in the list. */
function normalizeCompanies(items, { knownDomains = new Set(), knownNames = new Set() } = {}) {
  const out = [];
  const domains = new Set(knownDomains);
  const httpUrl = (value) => {
    const s = String(value || "").trim();
    return /^https?:\/\//i.test(s) ? s : "";
  };
  for (const item of Array.isArray(items) ? items : []) {
    const name = String(item?.name || "").trim().slice(0, 80);
    const url = httpUrl(item?.careers_url || item?.url);
    const website = httpUrl(item?.website);
    if (!name || (!url && !website)) continue;
    const domain = registrableDomain(website || url);
    if (!domain || domains.has(domain) || knownNames.has(name.toLowerCase())) continue;
    domains.add(domain);
    out.push({ name, url, website, domain, why: String(item?.why || "").slice(0, 200) });
  }
  return out;
}

const NOT_CAREERS_HOSTS =
  /(^|\.)(twitter|x|linkedin|facebook|instagram|youtube|glassdoor|naukri|indeed|ambitionbox|apna|shine|foundit|hirist|instahyre|cutshort|timesjobs|monsterindia|internshala|wellfound|angel)\.(com|co|in|io|app|tech)$/i;

function careersLinkScore(text, href) {
  const s = `${text} ${href}`.toLowerCase();
  if (/careers?\b/.test(s)) return 3;
  if (/\bjobs?\b|open (roles|positions)|openings|vacanc/.test(s)) return 2;
  if (/join[- ]?(us|our team)|work with us/.test(s)) return 1;
  return 0;
}

/** Picks the most careers-like link on a homepage ("Careers" beats "Jobs" beats "Join us"). */
function careersLinkFromHtml(html, baseUrl) {
  let best = { score: 0, url: "" };
  for (const m of String(html).matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try {
      url = new URL(m[1], baseUrl);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || NOT_CAREERS_HOSTS.test(url.hostname)) continue;
    const score = careersLinkScore(m[2].replace(/<[^>]+>/g, " "), url.pathname + url.hostname);
    if (score > best.score) best = { score, url: url.href };
  }
  return best.url;
}

const GUESSED_PATHS = ["/careers", "/jobs", "/company/careers", "/about/careers"];

/** Renders a JavaScript homepage in the shared browser and looks for its careers link. */
async function careersLinkInBrowser(context, website) {
  const page = await context.newPage();
  try {
    await page.goto(website, { waitUntil: "domcontentloaded", timeout: 20000 });
    await page.waitForTimeout(2000);
    return careersLinkFromHtml(await page.content(), page.url());
  } catch {
    return "";
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Finds a working careers page from the AI's suggestion, the homepage's links, common paths,
 * and finally the rendered homepage when `context` (a browser context) is given.
 */
async function findCareersPage({ url, website }, { context } = {}) {
  if (url) {
    const check = await verifyCareersUrl(url);
    if (check.ok) return check;
  }
  if (!website) return { ok: false, status: 0, finalUrl: url };
  const home = await verifyCareersUrl(website);
  const linked = home.html ? careersLinkFromHtml(home.html, home.finalUrl) : "";
  if (linked) {
    const check = await verifyCareersUrl(linked);
    if (check.ok) return check;
  }
  const origin = new URL(home.finalUrl || website).origin;
  for (const path of GUESSED_PATHS) {
    const check = await verifyCareersUrl(origin + path);
    if (check.status && check.status < 400 && /career|job|opening/i.test(check.html)) return check;
  }
  const rendered = context ? await careersLinkInBrowser(context, home.finalUrl || website) : "";
  if (rendered) return { ok: true, status: 200, finalUrl: rendered, html: "" };
  return { ok: false, status: home.status, finalUrl: url || website, error: home.ok ? "no careers link on the homepage" : `homepage HTTP ${home.status || home.error}` };
}

function discoverPrompt({ profile, queries, exclude, max }) {
  return `Find companies that are likely to hire this candidate, and each company's OFFICIAL careers page.

Candidate: ${(profile.target_roles || []).slice(0, 6).join("; ")} · ~${profile.experience_years || 0} years · skills: ${(profile.skills || []).slice(0, 12).join(", ")}
Cities: ${(profile.target_locations || []).join(", ") || profile.current_location || "India"}

Make exactly one web search per query below (no other searches, do not open pages), then answer from those results and what you already know:
${queries.map((q, i) => `${i + 1}. ${q}`).join("\n")}

Rules:
- Up to ${max} companies with real operations and open hiring in these cities.
- website is the company's main site. careers_url only if its own careers page or applicant-tracking page (Greenhouse, Lever, Workday, SmartRecruiters, Darwinbox, Keka, etc.) appeared in the results; otherwise leave it empty — we find it ourselves. Never a job board like Naukri, LinkedIn, Indeed, Apna, Glassdoor, Shine or Foundit.
- Skip: ${exclude.slice(0, 60).join(", ") || "none"}.

Return ONLY a JSON array: [{"name":"","website":"","careers_url":"","why":"one short phrase on why this company fits"}]`;
}

/** Fetches a careers URL; returns the final URL and whether it looks reachable. */
async function verifyCareersUrl(url) {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(15000) });
    const html = res.ok ? (await res.text()).slice(0, 800000) : "";
    return { ok: res.status < 400 || res.status === 403, status: res.status, finalUrl: res.url || url, html };
  } catch (err) {
    return { ok: false, status: 0, finalUrl: url, html: "", error: err.message };
  }
}

async function discoverCompanies({ ai, profile, queries, max, log }) {
  const knownDomains = new Set((profile.career_pages || []).map((p) => registrableDomain(p.url)).filter(Boolean));
  const knownNames = new Set([
    ...(profile.career_pages || []).map((p) => String(p.name || "").toLowerCase()),
    ...(profile.exclude_companies || []).map((c) => c.toLowerCase()),
  ]);
  const exclude = [...(profile.career_pages || []).map((p) => p.name).filter(Boolean), ...(profile.exclude_companies || [])];
  const text = await ai.search(discoverPrompt({ profile, queries, exclude, max }), { label: `Discovering companies: ${queries.join("; ")}`, reserve: 0.15 });
  const companies = normalizeCompanies(extractJsonArray(text), { knownDomains, knownNames }).slice(0, max);
  await log.info(`Company discovery suggested ${companies.length} new companies`);
  return companies;
}

module.exports = { registrableDomain, normalizeCompanies, discoverPrompt, verifyCareersUrl, careersLinkFromHtml, findCareersPage, discoverCompanies };
