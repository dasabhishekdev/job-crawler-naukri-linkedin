const { ApplyVault } = require("@jobportal/db");
const { isVaultReady } = require("@jobportal/core");
const { getBrowser } = require("../browser");
const { processQueuedApplications } = require("../apply/orchestrator");
const { backfillEligibleApplications } = require("../apply/enqueue");

/** Drains queued Easy Apply jobs for one user, one browser context at a time. */
async function autoApplyTask(ctx) {
  const { user, log, checkCancel, stage } = ctx;
  const vault = await ApplyVault.findOne({ user_id: user._id }).lean();
  if (!vault?.auto_apply_enabled) {
    await log.warn("Auto-apply is disabled.");
    return { processed: 0 };
  }
  if (!isVaultReady(vault)) {
    await log.warn("Apply vault is incomplete.");
    return { processed: 0 };
  }
  await backfillEligibleApplications({ userId: user._id, vault, log });
  await stage("apply", "Applying to queued jobs");
  await checkCancel();
  const browser = await getBrowser();
  return processQueuedApplications({ ...ctx, vault, browser });
}

module.exports = { autoApplyTask };
