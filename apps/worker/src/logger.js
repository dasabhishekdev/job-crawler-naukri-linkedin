const { CrawlLog } = require("@jobportal/db");

async function createLogger(runId, source = null) {
  return {
    async info(message, meta = {}) {
      console.log(`[${source || "worker"}] ${message}`);
      if (runId) {
        await CrawlLog.create({
          crawl_run_id: runId,
          level: "info",
          source,
          message,
          meta,
        });
      }
    },
    async warn(message, meta = {}) {
      console.warn(`[${source || "worker"}] ${message}`);
      if (runId) {
        await CrawlLog.create({
          crawl_run_id: runId,
          level: "warn",
          source,
          message,
          meta,
        });
      }
    },
    async error(message, meta = {}) {
      console.error(`[${source || "worker"}] ${message}`);
      if (runId) {
        await CrawlLog.create({
          crawl_run_id: runId,
          level: "error",
          source,
          message,
          meta,
        });
      }
    },
  };
}

module.exports = { createLogger };
