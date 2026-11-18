const { revalidateHighMatchJobs } = require("../crawl/revalidate");

/** Manual or scheduled pass: open inbox/saved job URLs and hide expired/dead ones. */
async function checkLinksTask(ctx) {
  const { user, log, stage, checkCancel, count, run } = ctx;
  const minScore = Number(run.payload?.min_score ?? 70);
  const limit = Math.min(100, Math.max(1, Number(run.payload?.limit ?? 50)));
  await stage("check", `Checking job links (≥${minScore}% match)`);
  await log.info(`Opening up to ${limit} inbox/saved job pages to find expired or removed postings`);
  const result = await revalidateHighMatchJobs({
    userId: user._id,
    minScore,
    limit,
    force: true,
    log,
    checkCancel,
  });
  await count({
    link_checked: result.checked,
    link_open: result.open,
    link_expired: result.expired,
    link_dead: result.dead,
  });
  await log.info(
    `Done: ${result.checked} checked · ${result.open} still open · ${result.expired + result.dead} moved to Hidden`
  );
  return result;
}

module.exports = { checkLinksTask };
