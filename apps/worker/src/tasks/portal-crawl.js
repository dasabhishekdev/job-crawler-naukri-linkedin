const { PORTAL_META, contextOptions, loadConnectedStates, refreshConnection, markExpired } = require("@jobportal/portals");
const { getBrowser } = require("../browser");
const { crawlLinkedIn } = require("../portals/linkedin");
const { crawlNaukri } = require("../portals/naukri");
const { ingestJobs } = require("./crawl");
const { withAi, loadResumeAndProfile } = require("./shared");

const CRAWLERS = { linkedin: crawlLinkedIn, naukri: crawlNaukri };

/** Crawls each connected portal with the user's saved session, then scores like the web crawl. */
async function portalCrawlTask(ctx) {
  const { user, log, stage, checkCancel } = ctx;
  const { resume, profile } = await loadResumeAndProfile(user);
  if (!profile?.target_roles?.length) throw new Error("Add at least one target role to your profile first.");
  const connections = await loadConnectedStates(user._id);
  if (!connections.length) throw new Error("Connect LinkedIn or Naukri in Settings first.");

  return withAi(ctx, async (ai) => {
    const browser = await getBrowser();
    const raw = [];
    const expired = [];
    for (const { portal, storageState } of connections) {
      const label = PORTAL_META[portal].label;
      await stage("search", `Searching ${label}`);
      const context = await browser.newContext({ ...contextOptions({ mobile: false }), storageState });
      try {
        const jobs = await CRAWLERS[portal]({ context, profile, log, checkCancel });
        raw.push(...jobs);
        await refreshConnection(user._id, portal, await context.storageState());
        await log.info(`${label}: collected ${jobs.length} job details`);
      } catch (err) {
        if (err.name === "SessionExpiredError") {
          expired.push(label);
          await markExpired(user._id, portal, err.message);
          await log.warn(err.message);
        } else if (err.name === "RunCancelled") {
          throw err;
        } else {
          await log.warn(`${label} crawl failed: ${err.message}`);
        }
      } finally {
        await context.close().catch(() => {});
      }
    }
    if (!raw.length && expired.length === connections.length) {
      throw new Error(`${expired.join(" and ")} ${expired.length > 1 ? "sessions" : "session"} expired. Reconnect in Settings.`);
    }
    return ingestJobs({ ai, raw, user, profile, resume, ...ctx });
  });
}

module.exports = { portalCrawlTask };
