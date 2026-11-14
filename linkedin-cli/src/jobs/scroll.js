const config = require("../config");

const JOB_CARD_SELECTOR =
  ".jobs-search-results__list-item, li.jobs-search-results__list-item, [data-occludable-job-id]";

const LIST_SELECTOR =
  ".jobs-search-results-list, .scaffold-layout__list, .jobs-search__results-list";

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function scrollJobList(page, maxScrolls) {
  const list = page.locator(LIST_SELECTOR).first();
  let previousCount = 0;
  let stableRounds = 0;

  for (let i = 0; i < maxScrolls; i++) {
    const currentCount = await page.locator(JOB_CARD_SELECTOR).count();

    if (currentCount === previousCount) {
      stableRounds += 1;
      if (stableRounds >= 3) {
        console.log(`  Jobs list stopped loading after ${i + 1} scrolls (${currentCount} cards)`);
        break;
      }
    } else {
      stableRounds = 0;
      previousCount = currentCount;
    }

    const listVisible = await list.isVisible().catch(() => false);
    if (listVisible) {
      await list.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
      });
    } else {
      await page.mouse.wheel(0, 4000);
    }

    await delay(config.scrollDelayMs);
    console.log(`  Jobs: scrolled ${i + 1}/${maxScrolls} (${currentCount} cards visible)`);
  }

  return await page.locator(JOB_CARD_SELECTOR).count();
}

module.exports = { scrollJobList, JOB_CARD_SELECTOR };
