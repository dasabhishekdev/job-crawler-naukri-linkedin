const config = require("../config");

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function expandSeeMore(page) {
  const buttons = page.locator(
    'button.feed-shared-inline-show-more-text__see-more-less-toggle, button[aria-label="see more"], button:has-text("…more"), button:has-text("see more")'
  );

  const count = await buttons.count();
  for (let i = 0; i < count; i++) {
    const btn = buttons.nth(i);
    if (await btn.isVisible().catch(() => false)) {
      await btn.click().catch(() => {});
      await delay(300);
    }
  }
}

async function scrollPage(page, maxScrolls, label = "page") {
  let previousHeight = 0;
  let stableRounds = 0;

  for (let i = 0; i < maxScrolls; i++) {
    await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
    await delay(config.scrollDelayMs);
    await expandSeeMore(page);

    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    if (currentHeight === previousHeight) {
      stableRounds += 1;
      if (stableRounds >= 2) {
        console.log(`  ${label}: stopped loading after ${i + 1} scrolls`);
        break;
      }
    } else {
      stableRounds = 0;
      previousHeight = currentHeight;
    }

    console.log(`  ${label}: scrolled ${i + 1}/${maxScrolls}`);
  }
}

const scrollFeed = (page, maxScrolls) => scrollPage(page, maxScrolls, "Feed");
const scrollSearch = (page, maxScrolls) => scrollPage(page, maxScrolls, "Search");

module.exports = { scrollPage, scrollFeed, scrollSearch, expandSeeMore };
