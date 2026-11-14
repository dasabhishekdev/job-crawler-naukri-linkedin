const fs = require("fs");
const { chromium } = require("playwright");
const config = require("./config");
const { loadProfile, getSearchQueries } = require("./profile");
const { scrollFeed, scrollSearch } = require("./feed/scroll");
const { extractPosts } = require("./feed/extractor");
const { parseLead, isRelevantLead } = require("./feed/parser");
const { openSearch } = require("./search/query");
const { leadExists, saveLead, getLeadCount, closeDb } = require("./storage/sqlite");

function processPosts(posts, profile, stats) {
  for (const raw of posts) {
    stats.scanned += 1;
    const lead = parseLead(raw, profile);

    if (!isRelevantLead(lead, config.minMatchScore)) {
      continue;
    }

    if (leadExists(lead.post_url)) {
      stats.skipped += 1;
      continue;
    }

    const inserted = saveLead(lead);
    if (!inserted) {
      stats.skipped += 1;
      continue;
    }

    stats.saved += 1;
    const emailInfo =
      lead.emails.length > 0 ? lead.emails.join(", ") : "no email in post";
    const sourceInfo =
      lead.source === "search" && lead.search_query
        ? `search: "${lead.search_query}"`
        : lead.source;

    console.log(`✓ Match (score ${lead.match_score}) — ${lead.author_name || "Unknown"}`);
    console.log(`  Source: ${sourceInfo}`);
    console.log(`  Reasons: ${lead.match_reasons.join(", ")}`);
    console.log(`  Email: ${emailInfo}`);
    console.log(`  URL: ${lead.post_url}\n`);
  }
}

async function scanFeed(page, profile, stats) {
  console.log("\n=== Scanning LinkedIn Feed ===\n");
  await page.goto(config.feedUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  console.log("Scrolling feed to load more posts...");
  await scrollFeed(page, config.maxScrolls);

  const posts = await extractPosts(page, "feed");
  console.log(`Extracted ${posts.length} posts from feed`);
  processPosts(posts, profile, stats);
}

async function scanSearch(page, profile, queries, stats) {
  console.log("\n=== Scanning LinkedIn Search ===\n");

  for (const query of queries) {
    console.log(`\n--- Search: "${query}" ---`);
    await openSearch(page, query);

    console.log("Scrolling search results to load more posts...");
    await scrollSearch(page, config.maxSearchScrolls);

    const posts = await extractPosts(page, "search", query);
    console.log(`Extracted ${posts.length} posts for query "${query}"`);
    processPosts(posts, profile, stats);
  }
}

async function main() {
  if (!fs.existsSync(config.storageStatePath)) {
    console.error(
      `No session found at ${config.storageStatePath}.\n` +
        'Run "npm run login" first to save your LinkedIn session.'
    );
    process.exit(1);
  }

  const profile = loadProfile();
  const queries = getSearchQueries(profile);
  const mode = config.scanMode.toLowerCase();

  console.log(`Profile: ${profile.name}`);
  console.log(`Scan mode: ${mode}`);
  if (mode !== "feed") {
    console.log(`Search queries: ${queries.length}`);
  }

  const browser = await chromium.launch({ headless: config.headless });
  const context = await browser.newContext({
    storageState: config.storageStatePath,
  });
  const page = await context.newPage();

  const stats = { saved: 0, skipped: 0, scanned: 0 };

  try {
    if (mode === "feed" || mode === "both") {
      await scanFeed(page, profile, stats);
    }

    if (mode === "search" || mode === "both") {
      if (queries.length === 0) {
        console.warn("No search queries configured. Add them to profile.json or SEARCH_QUERIES env.");
      } else {
        await scanSearch(page, profile, queries, stats);
      }
    }

    const total = getLeadCount();
    console.log(
      `\nDone. Scanned ${stats.scanned} posts, saved ${stats.saved} new matches, skipped ${stats.skipped} duplicates.`
    );
    console.log(`Total relevant leads in DB: ${total}`);
  } finally {
    await browser.close();
    closeDb();
  }
}

main().catch((err) => {
  console.error("Scanner failed:", err.message);
  closeDb();
  process.exit(1);
});
