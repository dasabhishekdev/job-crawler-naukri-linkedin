const { htmlToText } = require("./normalize");

function detectBoard(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { type: "generic" };
  }
  const host = url.hostname.toLowerCase();
  const first = url.pathname.split("/").filter(Boolean)[0];
  if (!first) return { type: "generic" };

  if (/(^|\.)greenhouse\.io$/.test(host) && /boards|job-boards/.test(host)) {
    return {
      type: "greenhouse",
      token: first,
      api: `https://boards-api.greenhouse.io/v1/boards/${first}/jobs?content=true`,
    };
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const apiHost = host === "jobs.eu.lever.co" ? "api.eu.lever.co" : "api.lever.co";
    return { type: "lever", token: first, api: `https://${apiHost}/v0/postings/${first}?mode=json` };
  }
  if (host === "jobs.ashbyhq.com") {
    return { type: "ashby", token: first, api: `https://api.ashbyhq.com/posting-api/job-board/${first}` };
  }
  return { type: "generic" };
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
  const lists = (job.lists || [])
    .map((list) => `${list.text}\n${htmlToText(list.content)}`)
    .join("\n");
  return {
    title: job.text,
    location: job.categories?.location || (job.categories?.allLocations || []).join(", "),
    apply_url: job.hostedUrl || job.applyUrl,
    description: [job.descriptionPlain || htmlToText(job.description), lists, job.additionalPlain]
      .filter(Boolean)
      .join("\n")
      .slice(0, 6000),
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

async function fetchBoardJobs(board, { timeoutMs = 20000 } = {}) {
  const res = await fetch(board.api, {
    headers: { accept: "application/json", "user-agent": "jobportal-crawler/1.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${board.type} board returned HTTP ${res.status}`);
  const data = await res.json();
  switch (board.type) {
    case "greenhouse":
      return (data.jobs || []).map(mapGreenhouseJob);
    case "lever":
      return (Array.isArray(data) ? data : []).map(mapLeverJob);
    case "ashby":
      return (data.jobs || []).filter((j) => j.isListed !== false).map(mapAshbyJob);
    case "generic":
      throw new Error("Generic career pages are crawled by the web agent");
    default: {
      const unknown = board.type;
      throw new Error(`Unknown board type: ${unknown}`);
    }
  }
}

module.exports = { detectBoard, fetchBoardJobs, mapGreenhouseJob, mapLeverJob, mapAshbyJob };
