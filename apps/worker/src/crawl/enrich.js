const { parseJobPostingJsonLd, stripHtml } = require("@jobportal/portals");
const { recordVisit } = require("./memory");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const MIN_DESCRIPTION = 300;
const MAX_PAGES = 40;

/** Only "gone" counts as dead: 403/429/5xx are often bot protection or blips. */
function isDeadStatus(status) {
  return status === 404 || status === 410;
}

function pick(html, pattern) {
  return html.match(pattern)?.[1] || "";
}

/** Reads job details from raw HTML: schema.org JobPosting first, then the page's main content. */
function extractFromHtml(html) {
  const scripts = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  const ld = parseJobPostingJsonLd(scripts);
  if (ld?.description) {
    return { title: ld.title, company: ld.company, location: ld.location, posted: ld.posted, description: ld.description };
  }
  const cleaned = html
    .replace(/<(script|style|noscript|svg|nav|header|footer|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const main = pick(cleaned, /<main[^>]*>([\s\S]*?)<\/main>/i) || pick(cleaned, /<article[^>]*>([\s\S]*?)<\/article>/i) || pick(cleaned, /<body[^>]*>([\s\S]*?)<\/body>/i);
  return {
    title: stripHtml(pick(cleaned, /<h1[^>]*>([\s\S]*?)<\/h1>/i)).slice(0, 200),
    company: "",
    location: "",
    posted: "",
    description: stripHtml(main).slice(0, 6000),
  };
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, { redirect: "follow", headers: { "user-agent": UA, accept: "text/html" }, signal: AbortSignal.timeout(10000) });
    const type = res.headers.get("content-type") || "";
    const html = res.ok && type.includes("html") ? (await res.text()).slice(0, 1_500_000) : "";
    if (!html) res.body?.cancel?.().catch(() => {});
    return { status: res.status, html, finalUrl: res.url || url };
  } catch (err) {
    return { status: 0, html: "", finalUrl: url, error: err.message };
  }
}

/**
 * Opens each web-search result once (no AI): drops dead links (404/410) and fills in missing
 * descriptions from the page so scoring has real requirements to work with.
 */
async function enrichJobs(records, { userId, log, concurrency = 6 }) {
  const alive = [];
  let dead = 0;
  let enriched = 0;
  let next = 0;
  const todo = records.slice(0, MAX_PAGES);
  async function worker() {
    while (next < todo.length) {
      const rec = todo[next++];
      const page = await fetchPage(rec.job_url);
      if (isDeadStatus(page.status)) {
        dead++;
        await recordVisit(userId, rec.job_url, { kind: "job", status: "not_found" });
        continue;
      }
      if (page.html && String(rec.description || "").length < MIN_DESCRIPTION) {
        const info = extractFromHtml(page.html);
        if (info.description.length > String(rec.description || "").length) {
          rec.description = info.description;
          enriched++;
        }
        rec.location = rec.location || info.location;
        rec.posted = rec.posted || info.posted;
      }
      await recordVisit(userId, rec.job_url, { kind: "job", status: page.status && page.status < 400 ? "ok" : page.status === 403 ? "blocked" : "error", jobs: 1 });
      alive.push(rec);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  alive.push(...records.slice(MAX_PAGES));
  if (log && (dead || enriched)) await log.info(`Read ${todo.length} job pages: ${enriched} descriptions added, ${dead} dead links dropped`);
  return { alive, dead, enriched };
}

module.exports = { enrichJobs, extractFromHtml, isDeadStatus };
