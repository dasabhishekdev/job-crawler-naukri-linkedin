const { Run, User } = require("@jobportal/db");
const { createRunContext, RunCancelled } = require("./run-context");
const { parseResumeTask } = require("./tasks/parse-resume");
const { crawlTask } = require("./tasks/crawl");
const { generateResumeTask } = require("./tasks/generate-resume");

const HANDLERS = {
  parse_resume: parseResumeTask,
  crawl: crawlTask,
  generate_resume: generateResumeTask,
};

const HEARTBEAT_MS = 30 * 1000;
const STALE_MS = 10 * 60 * 1000;

const active = new Map();

/** Atomically claims the oldest queued run whose user has no running run of the same kind. */
async function claimNext() {
  const busy = await Run.find({ status: "running" }, "user_id kind").lean();
  const busyKeys = new Set(busy.map((r) => `${r.user_id}:${r.kind}`));
  const candidates = await Run.find({ status: "queued", cancel_requested: { $ne: true } }, "_id user_id kind")
    .sort({ createdAt: 1 })
    .limit(50)
    .lean();
  for (const c of candidates) {
    if (busyKeys.has(`${c.user_id}:${c.kind}`)) continue;
    const claimed = await Run.findOneAndUpdate(
      { _id: c._id, status: "queued" },
      { $set: { status: "running", started_at: new Date(), heartbeat_at: new Date() } },
      { new: true }
    );
    if (claimed) return claimed;
  }
  return null;
}

async function finish(run, update) {
  await Run.updateOne(
    { _id: run._id, status: "running" },
    { $set: { ...update, finished_at: new Date(), stage: "done" } }
  );
}

async function execute(run) {
  const ctx = createRunContext(run);
  const heartbeat = setInterval(() => {
    Run.updateOne({ _id: run._id, status: "running" }, { $set: { heartbeat_at: new Date() } }).catch(() => {});
  }, HEARTBEAT_MS);
  try {
    const user = await User.findById(run.user_id);
    if (!user || user.status !== "active") throw new Error("Account is disabled");
    const handler = HANDLERS[run.kind];
    if (!handler) throw new Error(`No handler for ${run.kind}`);
    const result = await handler({ ...ctx, user });
    await finish(run, { status: "completed", result });
  } catch (err) {
    if (err instanceof RunCancelled) {
      await Run.updateOne({ _id: run._id }, { $set: { status: "cancelled", finished_at: new Date(), stage: "done" } });
      await ctx.log.warn("Cancelled");
    } else {
      await ctx.log.error(err.message);
      await finish(run, { status: "failed", error: err.message.slice(0, 500) });
    }
  } finally {
    clearInterval(heartbeat);
  }
}

async function tick(maxConcurrent) {
  while (active.size < maxConcurrent) {
    const run = await claimNext();
    if (!run) return;
    const promise = execute(run).finally(() => active.delete(String(run._id)));
    active.set(String(run._id), promise);
  }
}

async function failStaleRuns({ all = false } = {}) {
  const filter = { status: "running" };
  if (!all) filter.heartbeat_at = { $lt: new Date(Date.now() - STALE_MS) };
  const ids = (await Run.find(filter, "_id").lean()).map((r) => r._id).filter((id) => !active.has(String(id)));
  if (!ids.length) return 0;
  await Run.updateMany(
    { _id: { $in: ids } },
    { $set: { status: "failed", error: "The worker stopped during this run. Please run it again.", finished_at: new Date() } }
  );
  return ids.length;
}

function startRunner({ maxConcurrent = 3, pollMs = 5000 } = {}) {
  let stopped = false;
  let ticking = false;
  const loop = setInterval(async () => {
    if (stopped || ticking) return;
    ticking = true;
    try {
      await tick(maxConcurrent);
      await failStaleRuns();
    } catch (err) {
      console.error("[runner]", err.message);
    } finally {
      ticking = false;
    }
  }, pollMs);
  return {
    async stop() {
      stopped = true;
      clearInterval(loop);
      await Promise.allSettled(active.values());
    },
  };
}

module.exports = { startRunner, failStaleRuns, claimNext };
