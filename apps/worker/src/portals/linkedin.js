const {
  PORTAL_META,
  LINKEDIN_RECOMMENDED_URL,
  linkedinSearchUrl,
  linkedinJobUrl,
  extractLinkedInJobIds,
  parseJobPostingJsonLd,
} = require("@jobportal/portals");
const { open, humanDelay, scrollAll, collectHrefs, jsonLdScripts, firstText } = require("./common");

const PORTAL = "linkedin";

function fromDocumentTitle(title) {
  const parts = String(title || "")
    .replace(/^\(\d+\)\s*/, "")
    .split(" | ")
    .map((s) => s.trim());
  return parts.length >= 3 ? { title: parts[0], company: parts[1] } : {};
}

/** Parses "Bengaluru, Karnataka, India · 2 days ago · 40 applicants" style top-card text. */
function parseTopCard(text) {
  const parts = String(text || "")
    .split(/[·•]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    location: parts[0] || "",
    posted: parts.find((p) => /\b(ago|today|just now|reposted)\b/i.test(p)) || "",
  };
}

async function jobDetails(page, id) {
  await open(page, PORTAL, linkedinJobUrl(id));
  await page
    .locator('button[aria-label*="more" i], button:has-text("See more"), button:has-text("Show more")')
    .first()
    .click({ timeout: 1500 })
    .catch(() => {});

  const ld = parseJobPostingJsonLd(await jsonLdScripts(page)) || {};
  const byTitle = fromDocumentTitle(await page.title().catch(() => ""));
  const topCard = parseTopCard(
    await firstText(page, [
      ".job-details-jobs-unified-top-card__tertiary-description-container",
      ".job-details-jobs-unified-top-card__primary-description-container",
      ".jobs-unified-top-card__subtitle-primary-grouping",
    ])
  );
  const title =
    ld.title ||
    (await firstText(page, [".job-details-jobs-unified-top-card__job-title", "h1.t-24", ".top-card-layout__title", "h1"])) ||
    byTitle.title;
  const company =
    ld.company ||
    (await firstText(page, [
      ".job-details-jobs-unified-top-card__company-name a",
      ".job-details-jobs-unified-top-card__company-name",
      ".topcard__org-name-link",
    ])) ||
    byTitle.company;
  const description =
    ld.description ||
    (await firstText(page, [".jobs-description__content", "#job-details", ".jobs-box__html-content", ".description__text"]));

  return {
    source: PORTAL,
    title,
    company,
    location: ld.location || topCard.location,
    posted: ld.posted || topCard.posted,
    description: String(description || "").slice(0, 6000),
    experience: ld.experience || "",
    apply_url: linkedinJobUrl(id),
  };
}

/** Crawls LinkedIn recommended jobs plus up to `searches` searches; returns raw postings. */
async function crawlLinkedIn({ context, profile, log, checkCancel, searches = 2, maxDetails = 20 }) {
  const page = await context.newPage();
  const found = new Map();
  const add = (ids, label) => ids.forEach((id) => found.has(id) || found.set(id, label));

  await open(page, PORTAL, PORTAL_META.linkedin.homeUrl);
  await humanDelay();
  await open(page, PORTAL, LINKEDIN_RECOMMENDED_URL);
  await scrollAll(page);
  add(extractLinkedInJobIds(await collectHrefs(page)), "LinkedIn · recommended");
  await log.info(`LinkedIn recommended: ${found.size} jobs`);

  const city = (profile.target_locations || [])[0] || profile.current_location || "India";
  for (const role of (profile.target_roles || []).slice(0, searches)) {
    await checkCancel();
    await humanDelay();
    await open(page, PORTAL, linkedinSearchUrl(role, city));
    await scrollAll(page);
    const before = found.size;
    add(extractLinkedInJobIds(await collectHrefs(page)), "LinkedIn · search");
    await log.info(`LinkedIn search "${role}" in ${city}: ${found.size - before} new jobs`);
  }

  const jobs = [];
  for (const [id, label] of [...found].slice(0, maxDetails)) {
    await checkCancel();
    await humanDelay();
    try {
      const job = await jobDetails(page, id);
      if (job.title && job.company) {
        jobs.push({ ...job, source_site: label });
        await log.job(`Read LinkedIn job: ${job.title} at ${job.company}`);
      }
    } catch (err) {
      if (err.name === "SessionExpiredError") throw err;
      await log.warn(`LinkedIn job ${id}: ${err.message}`);
    }
  }
  await page.close().catch(() => {});
  return jobs;
}

module.exports = { crawlLinkedIn, parseTopCard, fromDocumentTitle };
