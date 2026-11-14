const {
  PORTAL_META,
  NAUKRI_RECOMMENDED_URL,
  naukriSearchUrl,
  extractNaukriJobLinks,
  parseJobPostingJsonLd,
} = require("@jobportal/portals");
const { open, humanDelay, scrollAll, collectHrefs, jsonLdScripts, firstText } = require("./common");

const PORTAL = "naukri";

async function jobDetails(page, url) {
  await open(page, PORTAL, url);
  await page
    .locator('button:has-text("Read more"), span:has-text("Read more"), [class*="read-more"]')
    .first()
    .click({ timeout: 1200 })
    .catch(() => {});

  const ld = parseJobPostingJsonLd(await jsonLdScripts(page)) || {};
  const title = ld.title || (await firstText(page, ["h1.jd-header-title", "h1.title", "h1"]));
  const company =
    ld.company || (await firstText(page, [".jd-header-comp-name a", ".jd-header-comp-name", "a.comp-name", '[class*="comp-name"]']));
  const location = ld.location || (await firstText(page, ['[class*="location"] a', '[class*="location"]', ".loc"]));
  const posted = (await firstText(page, ['[class*="jhc__stat"]:has-text("Posted")', ".jd-posted-on", '[class*="posted"]'])).replace(/^posted:?\s*/i, "");
  const experience = await firstText(page, ['[class*="exp"] span', ".exp", '[class*="experience"]']);
  const description = ld.description || (await firstText(page, ['[class*="job-desc"]', ".dang-inner-html", "#jobDescriptionText"]));

  return {
    source: PORTAL,
    title,
    company,
    location,
    posted: posted || ld.posted,
    experience: ld.experience || experience,
    description: String(description || "").slice(0, 6000),
    apply_url: url,
  };
}

/** Crawls Naukri recommended jobs plus up to `searches` searches; returns raw postings. */
async function crawlNaukri({ context, profile, log, checkCancel, searches = 2, maxDetails = 20 }) {
  const page = await context.newPage();
  const found = new Map();
  const add = (links, label) => links.forEach((l) => found.has(l) || found.set(l, label));

  await open(page, PORTAL, PORTAL_META.naukri.homeUrl);
  await humanDelay();
  await open(page, PORTAL, NAUKRI_RECOMMENDED_URL);
  await scrollAll(page);
  add(extractNaukriJobLinks(await collectHrefs(page)), "Naukri · recommended");
  await log.info(`Naukri recommended: ${found.size} jobs`);

  const city = (profile.target_locations || [])[0] || profile.current_location || "";
  for (const role of (profile.target_roles || []).slice(0, searches)) {
    await checkCancel();
    await humanDelay();
    await open(page, PORTAL, naukriSearchUrl(role, city, profile.experience_years));
    await scrollAll(page, 2);
    const before = found.size;
    add(extractNaukriJobLinks(await collectHrefs(page)), "Naukri · search");
    await log.info(`Naukri search "${role}"${city ? ` in ${city}` : ""}: ${found.size - before} new jobs`);
  }

  const jobs = [];
  for (const [url, label] of [...found].slice(0, maxDetails)) {
    await checkCancel();
    await humanDelay();
    try {
      const job = await jobDetails(page, url);
      if (job.title && job.company) jobs.push({ ...job, source_site: label });
    } catch (err) {
      if (err.name === "SessionExpiredError") throw err;
      await log.warn(`Naukri job: ${err.message}`);
    }
  }
  await page.close().catch(() => {});
  return jobs;
}

module.exports = { crawlNaukri };
