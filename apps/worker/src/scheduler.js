const cron = require("node-cron");
const { User, Profile, enqueueRun } = require("@jobportal/db");
const { aiReady } = require("@jobportal/ai");

async function queueHourlyCrawls() {
  const users = await User.find({ status: "active", "crawler.hourly_enabled": true });
  let queued = 0;
  for (const user of users) {
    if (!aiReady(user)) continue;
    const profile = await Profile.findOne({ user_id: user._id }, "target_roles").lean();
    if (!profile?.target_roles?.length) continue;
    try {
      const result = await enqueueRun({
        userId: user._id,
        kind: "crawl",
        triggeredBy: "schedule",
        dailyLimit: user.crawler?.daily_run_limit,
      });
      if (result.queued) queued++;
    } catch (err) {
      if (err.name !== "QueueLimitError") console.error(`[scheduler] ${user.email}: ${err.message}`);
    }
  }
  console.log(`[scheduler] Hourly crawl queued for ${queued}/${users.length} users`);
}

function startScheduler() {
  return cron.schedule(
    "0 * * * *",
    () => queueHourlyCrawls().catch((err) => console.error("[scheduler]", err.message)),
    { timezone: "Asia/Kolkata" }
  );
}

module.exports = { startScheduler, queueHourlyCrawls };
