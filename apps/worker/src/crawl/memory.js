const { VisitedPage, JobPosting } = require("@jobportal/db");

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** Records that the agent visited a URL (upsert: counts visits, keeps the last outcome). */
async function recordVisit(userId, url, { kind = "job", status = "ok", jobs = 0, note = "" } = {}) {
  if (!url) return;
  await VisitedPage.updateOne(
    { user_id: userId, url },
    {
      $setOnInsert: { first_at: new Date(), domain: domainOf(url) },
      $set: { kind, last_at: new Date(), last_status: status, note: String(note || "").slice(0, 200) },
      $inc: { visits: 1, jobs_found: jobs },
    },
    { upsert: true }
  ).catch(() => {});
}

/** URLs from `urls` the agent already stored as jobs or visited successfully within `hours`. */
async function alreadySeen(userId, urls, hours = 72) {
  if (!urls.length) return new Set();
  const since = new Date(Date.now() - hours * 3600 * 1000);
  const [jobs, visits] = await Promise.all([
    JobPosting.find({ user_id: userId, job_url: { $in: urls } }, "job_url").lean(),
    VisitedPage.find({ user_id: userId, url: { $in: urls }, last_at: { $gte: since }, last_status: "ok" }, "url").lean(),
  ]);
  return new Set([...jobs.map((j) => j.job_url), ...visits.map((v) => v.url)]);
}

module.exports = { recordVisit, alreadySeen, domainOf };
