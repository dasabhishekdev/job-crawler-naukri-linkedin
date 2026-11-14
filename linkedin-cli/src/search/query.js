const config = require("../config");

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSearchUrl(keywords, filter = "content") {
  const encoded = encodeURIComponent(keywords);

  if (filter === "all") {
    return `https://www.linkedin.com/search/results/all/?keywords=${encoded}&origin=GLOBAL_SEARCH_HEADER`;
  }

  return `https://www.linkedin.com/search/results/content/?keywords=${encoded}&origin=GLOBAL_SEARCH_HEADER`;
}

async function openSearch(page, keywords) {
  const url = buildSearchUrl(keywords, "content");
  console.log(`  Query: "${keywords}"`);
  console.log(`  URL: ${url}`);

  await page.goto(url, { waitUntil: "domcontentloaded" });
  await delay(2000);

  const postsTab = page
    .locator('button:has-text("Posts"), a:has-text("Posts")')
    .first();

  if (await postsTab.isVisible().catch(() => false)) {
    await postsTab.click().catch(() => {});
    await delay(1500);
  }

  await page
    .waitForSelector(
      ".feed-shared-update-v2, .update-components-update-v2, .reusable-search__result-container, div[data-urn*='activity']",
      { timeout: 15000 }
    )
    .catch(() => {});

  return url;
}

module.exports = { buildSearchUrl, openSearch };
