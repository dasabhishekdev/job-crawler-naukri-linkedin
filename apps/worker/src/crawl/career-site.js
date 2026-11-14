const { parseJobPostingJsonLd } = require("@jobportal/portals");
const { humanDelay, scrollAll, jsonLdScripts, firstText } = require("../portals/common");
const { detectBoard, detectBoardFromHtml } = require("./career-boards");
const { registrableDomain } = require("./companies");
const { recordVisit, alreadySeen } = require("./memory");

const ATS_HOSTS = /(darwinbox\.in|keka\.com|zohorecruit\.\w+|freshteam\.com|recruitee\.com|workable\.com|bamboohr\.com|icims\.com|successfactors\.(com|eu)|taleo\.net|oraclecloud\.com|jobvite\.com|myworkdayjobs\.com|smartrecruiters\.com|lever\.co|greenhouse\.io|ashbyhq\.com|teamtailor\.com|breezy\.hr|kekahire\.com)$/i;
const SOCIAL_HOSTS = /(facebook|twitter|x|linkedin|instagram|youtube|glassdoor|naukri|indeed)\.com$/i;
const JOB_SEGMENT = /^(job|jobs|career|careers|position|positions|opening|openings|vacanc\w*|requisition\w*|opportunit\w*|job-details|jobdetails)$/i;
const JOB_QUERY = /(^|&)(job_?id|jobid|req_?id|requisition_?id|gh_jid|pid)=/i;

function cleanUrl(href) {
  try {
    const url = new URL(href);
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function looksLikeJobDetail(url, pageUrl) {
  if (JOB_QUERY.test(url.search.slice(1))) return true;
  const segments = url.pathname.split("/").filter(Boolean);
  const idx = segments.findIndex((s) => JOB_SEGMENT.test(s));
  if (idx >= 0 && idx < segments.length - 1) return true;
  return ATS_HOSTS.test(url.hostname) && url.pathname.length > (pageUrl.pathname.length || 1) + 3;
}

/** Picks likely job-detail links from a careers page that match the profile's title tokens. */
function pickJobLinks(anchors, { pageUrl, tokens = [] }) {
  const page = new URL(pageUrl);
  const site = registrableDomain(pageUrl);
  const seen = new Set();
  const out = [];
  for (const a of anchors || []) {
    const url = cleanUrl(a.href);
    if (!url || !/^https?:$/.test(url.protocol)) continue;
    const host = url.hostname.toLowerCase();
    if (SOCIAL_HOSTS.test(host)) continue;
    if (registrableDomain(url.href) !== site && !ATS_HOSTS.test(host)) continue;
    const key = url.href.replace(/\/+$/, "");
    if (seen.has(key) || key === page.href.replace(/#.*$/, "").replace(/\/+$/, "")) continue;
    if (!looksLikeJobDetail(url, page)) continue;
    const label = `${a.text || ""} ${decodeURIComponent(url.pathname).replace(/[-_/]+/g, " ")}`.toLowerCase();
    if (tokens.length && !tokens.some((t) => label.includes(t))) continue;
    seen.add(key);
    out.push({ url: key, text: String(a.text || "").trim() });
  }
  return out;
}

async function readJobPage(page, link, entry) {
  await page.goto(link.url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
  const ld = parseJobPostingJsonLd(await jsonLdScripts(page)) || {};
  const title = ld.title || (await firstText(page, ["h1", '[class*="job-title" i]', '[class*="jobtitle" i]'])) || link.text;
  const description =
    ld.description || (await firstText(page, ['[class*="job-description" i]', '[class*="description" i]', "main", "article", "body"]));
  return {
    source: "career_page",
    title: String(title || "").trim().slice(0, 200),
    company: ld.company || entry.name,
    location: ld.location || (await firstText(page, ['[class*="location" i]'])).slice(0, 160),
    posted: ld.posted || "",
    experience: ld.experience || "",
    description: String(description || "").slice(0, 6000),
    apply_url: page.url(),
    source_site: `${entry.name || registrableDomain(link.url)} careers`,
  };
}

/**
 * Opens a company careers page in the browser. Returns `{ board }` when it links to a known
 * job system (crawl that via its API instead), otherwise `{ jobs, links }` read from job pages.
 */
async function crawlCareerSite({ context, entry, tokens, userId, log, maxJobs = 12 }) {
  const page = await context.newPage();
  try {
    const res = await page.goto(entry.url, { waitUntil: "domcontentloaded", timeout: 45000 });
    if (res && (res.status() === 404 || res.status() === 410)) throw Object.assign(new Error(`Careers page not found (HTTP ${res.status()})`), { code: "NOT_FOUND" });
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    const direct = detectBoard(page.url());
    const board = direct.type !== "generic" ? direct : detectBoardFromHtml(await page.content());
    if (board) return { board };

    await scrollAll(page, 3);
    const anchors = await page.$$eval("a[href]", (as) => as.map((a) => ({ href: a.href, text: (a.innerText || a.textContent || "").trim().slice(0, 150) })));
    const links = pickJobLinks(anchors, { pageUrl: page.url(), tokens });
    const seen = await alreadySeen(userId, links.map((l) => l.url));
    const todo = links.filter((l) => !seen.has(l.url)).slice(0, maxJobs);
    if (links.length) await log.info(`${entry.name}: ${links.length} matching job links (${links.length - todo.length} already known)`);

    const jobs = [];
    for (const link of todo) {
      await humanDelay(1200, 2500);
      try {
        const job = await readJobPage(page, link, entry);
        if (job.title) {
          jobs.push(job);
          await log.job(`Read ${entry.name} job: ${job.title}`);
        }
        await recordVisit(userId, link.url, { kind: "job", status: "ok", jobs: job.title ? 1 : 0 });
      } catch (err) {
        await recordVisit(userId, link.url, { kind: "job", status: "error", note: err.message });
      }
    }
    return { jobs, links: links.length };
  } finally {
    await page.close().catch(() => {});
  }
}

module.exports = { crawlCareerSite, pickJobLinks };
