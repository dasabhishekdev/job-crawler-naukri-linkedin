const { AppSettings, CrawlRun } = require("@jobportal/db");
const { getActiveCandidate } = require("./candidates");

const SETTINGS_ID = "crawler";

const DEFAULTS = {
  hourly_enabled: false,
  sources: { web_agent: true, career_pages: true },
  location: "Bengaluru, Karnataka, India",
  max_job_age_days: 14,
  max_agent_batches: 3,
  jobs_per_batch: 8,
  max_score_per_run: 60,
  min_fit_to_sync: 50,
  tailor_min_fit: 70,
  tailor_max_ats: 75,
  max_tailor_per_run: 8,
};

const NUMERIC_LIMITS = {
  max_job_age_days: [1, 60],
  max_agent_batches: [1, 8],
  jobs_per_batch: [3, 15],
  max_score_per_run: [5, 200],
  min_fit_to_sync: [0, 100],
  tailor_min_fit: [0, 100],
  tailor_max_ats: [0, 100],
  max_tailor_per_run: [0, 30],
};

function merge(data = {}) {
  return { ...DEFAULTS, ...data, sources: { ...DEFAULTS.sources, ...(data.sources || {}) } };
}

async function getCrawlerSettings() {
  const doc = await AppSettings.findById(SETTINGS_ID).lean();
  return merge(doc?.data);
}

async function saveCrawlerSettings(patch = {}) {
  const current = await getCrawlerSettings();
  const next = merge({ ...current, ...patch, sources: { ...current.sources, ...(patch.sources || {}) } });
  next.hourly_enabled = Boolean(next.hourly_enabled);
  next.sources.web_agent = Boolean(next.sources.web_agent);
  next.sources.career_pages = Boolean(next.sources.career_pages);
  next.location = String(next.location || DEFAULTS.location).slice(0, 120);
  for (const [key, [min, max]] of Object.entries(NUMERIC_LIMITS)) {
    const n = Math.round(Number(next[key]));
    next[key] = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : DEFAULTS[key];
  }
  await AppSettings.findByIdAndUpdate(SETTINGS_ID, { $set: { data: next } }, { upsert: true, setDefaultsOnInsert: true });
  return next;
}

function nextHourlyRun(now = new Date()) {
  const next = new Date(now);
  next.setMinutes(0, 0, 0);
  next.setHours(next.getHours() + 1);
  return next;
}

/** Queues an all-sources run for the active candidate unless one is already queued or running. */
async function queueMultiRun({ triggeredBy = "manual" } = {}) {
  const busy = await CrawlRun.findOne({ source: "multi", status: { $in: ["queued", "running"] } }).lean();
  if (busy) return { run: busy, queued: false };
  const candidate = await getActiveCandidate();
  const run = await CrawlRun.create({
    source: "multi",
    status: "queued",
    triggered_by: triggeredBy,
    candidate_id: candidate?._id,
  });
  return { run, queued: true };
}

module.exports = { getCrawlerSettings, saveCrawlerSettings, nextHourlyRun, queueMultiRun, CRAWLER_DEFAULTS: DEFAULTS };
