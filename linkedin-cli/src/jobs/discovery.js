const config = require("../config");
const { randomDelay } = require("../utils/delay");
const { openJobSearch, SessionExpiredError } = require("./search");
const { extractJobCards } = require("./extractor");
const {
  saveDiscoveredJob,
  isPageCompleted,
  markPageCompleted,
} = require("../storage/jobs-db");

async function discoverPage(page, keyword, location, pageOffset) {
  if (isPageCompleted(location, keyword, pageOffset)) {
    console.log(`  Skipping completed page: "${keyword}" start=${pageOffset}`);
    return { cards: [], skipped: true };
  }

  await openJobSearch(page, keyword, location, pageOffset);
  await randomDelay(2000, 4000);

  const cards = await extractJobCards(page);
  let newCount = 0;

  for (const card of cards) {
    if (!card.job_url) continue;
    const inserted = saveDiscoveredJob({
      ...card,
      search_keyword: keyword,
    });
    if (inserted) newCount += 1;
  }

  markPageCompleted(location, keyword, pageOffset);
  console.log(`  Page start=${pageOffset}: ${cards.length} cards, ${newCount} new`);

  return { cards, newCount, skipped: false };
}

async function discoverKeyword(page, keyword, location) {
  const maxOffset = config.maxPagesPerKeyword * config.pageSize;
  let totalNew = 0;

  for (let start = 0; start < maxOffset; start += config.pageSize) {
    try {
      const result = await discoverPage(page, keyword, location, start);

      if (!result.skipped) {
        totalNew += result.newCount || 0;
      }

      if (!result.skipped && result.cards.length === 0) {
        console.log(`  No cards at start=${start}, moving to next keyword`);
        break;
      }

      if (!result.skipped && (result.newCount || 0) === 0 && result.cards.length > 0) {
        console.log(`  No new jobs at start=${start}, moving to next keyword`);
        break;
      }
    } catch (err) {
      if (err instanceof SessionExpiredError) throw err;
      console.warn(`  Discovery failed at start=${start}: ${err.message}`);
      await randomDelay(config.rateLimitPauseMs, config.rateLimitPauseMs + 5000);
    }
  }

  return totalNew;
}

module.exports = { discoverPage, discoverKeyword };
