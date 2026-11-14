const config = require("../config");
const { delay } = require("../utils/delay");

function buildJobSearchUrl(keywords, location, start = 0) {
  const params = new URLSearchParams({
    keywords,
    location,
    origin: "JOB_SEARCH_PAGE_SEARCH_BUTTON",
  });
  if (start > 0) {
    params.set("start", String(start));
  }
  return `https://www.linkedin.com/jobs/search/?${params.toString()}`;
}

class SessionExpiredError extends Error {
  constructor() {
    super("LinkedIn session expired. Run npm run login.");
    this.name = "SessionExpiredError";
  }
}

async function gotoWithRetry(page, url) {
  const backoffs = config.navRetryBackoffMs;

  for (let attempt = 0; attempt < backoffs.length; attempt++) {
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      });

      if (page.url().includes("/login") || page.url().includes("/authwall")) {
        throw new SessionExpiredError();
      }

      if (response && response.status() >= 400) {
        throw new Error(`HTTP ${response.status()}`);
      }

      return;
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err;
      if (attempt === backoffs.length - 1) throw err;
      console.warn(`  Retry ${attempt + 1}/${backoffs.length - 1}: ${err.message}`);
      await delay(backoffs[attempt]);
    }
  }
}

async function openJobSearch(page, keywords, location, start = 0) {
  const url = buildJobSearchUrl(keywords, location, start);
  console.log(`  Keyword: "${keywords}" | Location: "${location}" | start=${start}`);
  console.log(`  URL: ${url}`);

  await gotoWithRetry(page, url);
  await delay(2000);

  await page
    .waitForSelector(
      ".jobs-search-results__list-item, [data-occludable-job-id], .jobs-search-results-list",
      { timeout: 20000 }
    )
    .catch(() => {});

  return url;
}

module.exports = {
  buildJobSearchUrl,
  openJobSearch,
  gotoWithRetry,
  SessionExpiredError,
};
