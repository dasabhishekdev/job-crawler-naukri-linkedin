const cron = require("node-cron");
const { User, Profile, PortalConnection, ApplyVault, enqueueRun } = require("@jobportal/db");
const { aiReady } = require("@jobportal/ai");

async function queueFor(users, kind, { needsRoles = true, dailyLimit } = {}) {
  let queued = 0;
  for (const user of users) {
    if (!aiReady(user) && kind !== "naukri_refresh" && kind !== "auto_apply") continue;
    if (needsRoles) {
      const profile = await Profile.findOne({ user_id: user._id }, "target_roles").lean();
      if (!profile?.target_roles?.length) continue;
    }
    try {
      const result = await enqueueRun({ userId: user._id, kind, triggeredBy: "schedule", dailyLimit: dailyLimit?.(user) });
      if (result.queued) queued++;
    } catch (err) {
      if (err.name !== "QueueLimitError") console.error(`[scheduler] ${kind} ${user.email}: ${err.message}`);
    }
  }
  console.log(`[scheduler] ${kind} queued for ${queued}/${users.length} users`);
}

async function usersWithConnection(portalFilter, userFilter) {
  const userIds = await PortalConnection.distinct("user_id", { status: "connected", ...portalFilter });
  return User.find({ _id: { $in: userIds }, status: "active", ...userFilter });
}

async function queueHourlyCrawls() {
  const users = await User.find({ status: "active", "crawler.hourly_enabled": true });
  await queueFor(users, "crawl", { dailyLimit: (u) => u.crawler?.daily_run_limit });
}

async function queuePortalCrawls() {
  await queueFor(await usersWithConnection({}, { "portals.crawl_enabled": { $ne: false } }), "portal_crawl");
}

async function queueNaukriRefresh() {
  await queueFor(await usersWithConnection({ portal: "naukri" }, { "portals.naukri_profile_refresh": true }), "naukri_refresh", {
    needsRoles: false,
  });
}

async function queueAutoApply() {
  const vaults = await ApplyVault.find({ auto_apply_enabled: true }, "user_id").lean();
  const users = await User.find({ _id: { $in: vaults.map((v) => v.user_id) }, status: "active" });
  await queueFor(users, "auto_apply", { needsRoles: false });
}

function schedule(expression, fn) {
  return cron.schedule(expression, () => fn().catch((err) => console.error("[scheduler]", err.message)), { timezone: "Asia/Kolkata" });
}

function startScheduler() {
  const jobs = [
    schedule("0 * * * *", queueHourlyCrawls),
    schedule("30 */3 * * *", queuePortalCrawls),
    schedule("15 9 * * *", queueNaukriRefresh),
    schedule("15,45 * * * *", queueAutoApply),
  ];
  return { stop: () => jobs.forEach((j) => j.stop()) };
}

module.exports = { startScheduler, queueHourlyCrawls, queuePortalCrawls, queueNaukriRefresh, queueAutoApply };
