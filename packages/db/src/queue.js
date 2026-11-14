const { Run } = require("./models");

const DAILY_LIMITS = { crawl: 24, generate_resume: 30, parse_resume: 20, portal_crawl: 10, naukri_refresh: 2 };

function startOfDayIst(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  return new Date(`${day}T00:00:00+05:30`);
}

class QueueLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "QueueLimitError";
  }
}

/**
 * Queues a run unless an equivalent one is already queued/running.
 * Throws QueueLimitError when the user's daily limit for this kind is used up.
 */
async function enqueueRun({ userId, kind, payload = {}, triggeredBy = "manual", dailyLimit }) {
  const active = { user_id: userId, kind, status: { $in: ["queued", "running"] } };
  if (kind === "generate_resume") active["payload.job_id"] = payload.job_id;
  const existing = await Run.findOne(active).sort("-createdAt");
  if (existing) return { run: existing, queued: false };

  const limit = dailyLimit ?? DAILY_LIMITS[kind];
  const today = await Run.countDocuments({ user_id: userId, kind, createdAt: { $gte: startOfDayIst() } });
  if (limit && today >= limit) {
    throw new QueueLimitError(`Daily limit reached (${limit} per day). Try again tomorrow.`);
  }
  const run = await Run.create({ user_id: userId, kind, payload, triggered_by: triggeredBy, status: "queued" });
  return { run, queued: true };
}

module.exports = { enqueueRun, startOfDayIst, QueueLimitError, DAILY_LIMITS };
