const { htmlToText } = require("./normalize");

const UA = "Mozilla/5.0 (compatible; JobCrawlerBot/1.0; +https://github.com/)";
const LOCALE = /^[a-z]{2}-[A-Z]{2}$/;

class BoardUnavailableError extends Error {
  constructor(type, detail) {
    super(`${type} is temporarily unavailable${detail ? ` (${detail})` : ""}`);
    this.name = "BoardUnavailableError";
  }
}

function workdayBoard(host, tenant, site, sitePrefix) {
  return {
    type: "workday",
    token: tenant,
    api: `https://${host}/wday/cxs/${tenant}/${site}/jobs`,
    cxs: `https://${host}/wday/cxs/${tenant}/${site}`,
    base: `https://${host}${sitePrefix}/${site}`,
  };
}

function detectBoard(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { type: "generic" };
  }
  const host = url.hostname.toLowerCase();
  const segments = url.pathname.split("/").filter(Boolean);
  const first = segments[0];

  const wd = host.match(/^([a-z0-9-]+)\.wd\d+\.myworkdayjobs\.com$/);
  if (wd) {
    const site = segments.find((s) => !LOCALE.test(s));
    return site ? workdayBoard(host, wd[1], site, "") : { type: "generic" };
  }
  if (/^wd\d+\.myworkdaysite\.com$/.test(host) && first === "recruiting" && segments[2]) {
    return workdayBoard(host, segments[1], segments[2], `/recruiting/${segments[1]}`);
  }
  if (!first) return { type: "generic" };
  if (/(^|\.)greenhouse\.io$/.test(host) && /boards|job-boards/.test(host)) {
    return { type: "greenhouse", token: first, api: `https://boards-api.greenhouse.io/v1/boards/${first}/jobs?content=true` };
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const apiHost = host === "jobs.eu.lever.co" ? "api.eu.lever.co" : "api.lever.co";
    return { type: "lever", token: first, api: `https://${apiHost}/v0/postings/${first}?mode=json` };
  }
  if (host === "jobs.ashbyhq.com") {
    return { type: "ashby", token: first, api: `https://api.ashbyhq.com/posting-api/job-board/${first}` };
  }
  if (host === "careers.smartrecruiters.com" || host === "jobs.smartrecruiters.com") {
    return { type: "smartrecruiters", token: first, api: `https://api.smartrecruiters.com/v1/companies/${first}/postings?limit=100` };
  }
  return { type: "generic" };
}

const EMBED_PATTERNS = [
  /https?:\/\/(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board\?for=)?[A-Za-z0-9_-]+/,
  /https?:\/\/jobs(?:\.eu)?\.lever\.co\/[A-Za-z0-9_.-]+/,
  /https?:\/\/jobs\.ashbyhq\.com\/[A-Za-z0-9_.-]+/,
  /https?:\/\/[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com\/(?:[a-z]{2}-[A-Z]{2}\/)?[A-Za-z0-9_-]+/,
  /https?:\/\/wd\d+\.myworkdaysite\.com\/recruiting\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+/,
  /https?:\/\/(?:careers|jobs)\.smartrecruiters\.com\/[A-Za-z0-9_-]+/,
];

/** Finds a known job system linked or embedded in a careers page's HTML. */
function detectBoardFromHtml(html) {
  const text = String(html || "").slice(0, 800000);
  for (const pattern of EMBED_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    const url = match[0].replace("embed/job_board?for=", "");
    const board = detectBoard(url);
    if (board.type !== "generic") return board;
  }
  return null;
}

function mapGreenhouseJob(job) {
  return {
    title: job.title,
    location: job.location?.name || "",
    apply_url: job.absolute_url,
    description: htmlToText(job.content).slice(0, 6000),
    posted: job.updated_at || job.first_published || "",
  };
}

function mapLeverJob(job) {
  const lists = (job.lists || []).map((list) => `${list.text}\n${htmlToText(list.content)}`).join("\n");
  return {
    title: job.text,
    location: job.categories?.location || (job.categories?.allLocations || []).join(", "),
    apply_url: job.hostedUrl || job.applyUrl,
    description: [job.descriptionPlain || htmlToText(job.description), lists, job.additionalPlain].filter(Boolean).join("\n").slice(0, 6000),
    posted: job.createdAt ? new Date(job.createdAt).toISOString() : "",
  };
}

function mapAshbyJob(job) {
  const secondary = (job.secondaryLocations || []).map((l) => l.location).filter(Boolean);
  return {
    title: job.title,
    location: [job.location, ...secondary].filter(Boolean).join(", "),
    apply_url: job.jobUrl || job.applyUrl,
    description: (job.descriptionPlain || htmlToText(job.descriptionHtml)).slice(0, 6000),
    posted: job.publishedAt || "",
  };
}

function mapWorkdayJob(board, job) {
  return {
    title: job.title,
    location: job.locationsText || "",
    apply_url: `${board.base}${job.externalPath}`,
    posted: job.postedOn || "",
    description: "",
    detail: job.externalPath,
  };
}

function mapSmartRecruitersJob(board, job) {
  return {
    title: job.name,
    location: job.location?.fullLocation || [job.location?.city, job.location?.country].filter(Boolean).join(", "),
    apply_url: `https://jobs.smartrecruiters.com/${board.token}/${job.id}`,
    posted: job.releasedDate || "",
    description: "",
    detail: job.ref,
  };
}

async function getJson(url, { method = "GET", body, timeoutMs = 20000 } = {}) {
  const res = await fetch(url, {
    method,
    redirect: "manual",
    headers: { accept: "application/json", "content-type": "application/json", "user-agent": UA },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const location = res.headers.get("location") || "";
  if (res.status >= 300 && res.status < 400) {
    if (/maintenance/i.test(location)) throw new BoardUnavailableError(new URL(url).hostname, "maintenance");
    throw new Error(`HTTP ${res.status} redirect`);
  }
  if (res.status === 429 || res.status >= 500) throw new BoardUnavailableError(new URL(url).hostname, `HTTP ${res.status}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** Lists jobs from a known job system. `searchTerms` narrows Workday and SmartRecruiters results. */
async function fetchBoardJobs(board, { searchTerms = [] } = {}) {
  switch (board.type) {
    case "greenhouse":
      return ((await getJson(board.api)).jobs || []).map(mapGreenhouseJob);
    case "lever": {
      const data = await getJson(board.api);
      return (Array.isArray(data) ? data : []).map(mapLeverJob);
    }
    case "ashby":
      return ((await getJson(board.api)).jobs || []).filter((j) => j.isListed !== false).map(mapAshbyJob);
    case "workday": {
      const terms = searchTerms.length ? searchTerms.slice(0, 2) : [""];
      const seen = new Map();
      for (const term of terms) {
        const data = await getJson(board.api, { method: "POST", body: { appliedFacets: {}, limit: 20, offset: 0, searchText: term } });
        for (const job of data.jobPostings || []) seen.set(job.externalPath, mapWorkdayJob(board, job));
      }
      return [...seen.values()];
    }
    case "smartrecruiters": {
      const terms = searchTerms.length ? searchTerms.slice(0, 2) : [""];
      const seen = new Map();
      for (const term of terms) {
        const data = await getJson(`${board.api}${term ? `&q=${encodeURIComponent(term)}` : ""}`);
        for (const job of data.content || []) seen.set(job.id, mapSmartRecruitersJob(board, job));
      }
      return [...seen.values()];
    }
    case "generic":
      throw new Error("Generic career pages are crawled in the browser");
    default: {
      const unknown = board.type;
      throw new Error(`Unknown board type: ${unknown}`);
    }
  }
}

/** Fills in the description for boards whose list endpoint omits it. */
async function fetchBoardJobDetail(board, job) {
  if (!job.detail || job.description) return job;
  switch (board.type) {
    case "workday": {
      const info = (await getJson(`${board.cxs}${job.detail}`)).jobPostingInfo || {};
      return { ...job, description: htmlToText(info.jobDescription).slice(0, 6000), location: info.location || job.location };
    }
    case "smartrecruiters": {
      const sections = (await getJson(job.detail)).jobAd?.sections || {};
      const text = [sections.jobDescription?.text, sections.qualifications?.text, sections.additionalInformation?.text].map(htmlToText).filter(Boolean).join("\n");
      return { ...job, description: text.slice(0, 6000) };
    }
    default:
      return job;
  }
}

module.exports = {
  detectBoard,
  detectBoardFromHtml,
  fetchBoardJobs,
  fetchBoardJobDetail,
  mapGreenhouseJob,
  mapLeverJob,
  mapAshbyJob,
  mapWorkdayJob,
  mapSmartRecruitersJob,
  BoardUnavailableError,
};
