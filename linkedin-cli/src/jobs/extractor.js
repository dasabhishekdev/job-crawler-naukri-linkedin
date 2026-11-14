const config = require("../config");

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function textFrom(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible().catch(() => false)) {
      const text = await locator.textContent().catch(() => null);
      if (text?.trim()) return text.trim();
    }
  }
  return null;
}

function parseJobId(url) {
  if (!url) return null;
  const match = url.match(/\/jobs\/view\/(\d+)/);
  return match ? match[1] : null;
}

async function extractJobCards(page) {
  return page.evaluate(() => {
    const seen = new Set();
    const results = [];
    const cards = document.querySelectorAll(
      ".jobs-search-results__list-item, li.jobs-search-results__list-item, [data-occludable-job-id]"
    );

    for (const card of cards) {
      const link = card.querySelector('a[href*="/jobs/view/"]');
      const href = link?.href || link?.getAttribute("href");
      if (!href) continue;

      const job_url = (href.startsWith("http") ? href : `https://www.linkedin.com${href}`).split("?")[0];
      if (seen.has(job_url)) continue;
      seen.add(job_url);

      const titleEl =
        card.querySelector(".job-card-list__title") ||
        card.querySelector(".job-card-container__link strong") ||
        card.querySelector("a.job-card-container__link");

      const companyEl =
        card.querySelector(".job-card-container__primary-description") ||
        card.querySelector(".artdeco-entity-lockup__subtitle");

      const locationEl =
        card.querySelector(".job-card-container__metadata-item") ||
        card.querySelector(".artdeco-entity-lockup__caption");

      const postedEl = card.querySelector("time") || card.querySelector(".job-card-container__footer-item");

      results.push({
        job_title: titleEl?.innerText?.trim() || null,
        company: companyEl?.innerText?.trim() || null,
        location: locationEl?.innerText?.trim() || null,
        posted: postedEl?.innerText?.trim() || postedEl?.getAttribute("datetime") || null,
        job_url,
        job_id: job_url.match(/\/jobs\/view\/(\d+)/)?.[1] || null,
      });
    }

    return results;
  });
}

async function extractJobDetails(page, card) {
  const cardLocator = page
    .locator(`a[href*="/jobs/view/${card.job_id}"], a[href="${card.job_url}"]`)
    .first();

  if (await cardLocator.isVisible().catch(() => false)) {
    await cardLocator.click();
    await delay(config.actionDelayMs);
  }

  const job_title = await textFrom(page, [
    ".job-details-jobs-unified-top-card__job-title",
    "h1.t-24",
    "h1.job-details-jobs-unified-top-card__job-title",
  ]);

  const company = await textFrom(page, [
    ".job-details-jobs-unified-top-card__company-name",
    ".job-details-jobs-unified-top-card__primary-description a",
  ]);

  const location = await textFrom(page, [
    ".job-details-jobs-unified-top-card__bullet",
    ".job-details-jobs-unified-top-card__primary-description-container span",
  ]);

  const posted = await textFrom(page, [
    ".jobs-unified-top-card__posted-date",
    "span.tvm__text--low-emphasis",
  ]);

  const employment_type = await textFrom(page, [
    ".job-details-jobs-unified-top-card__job-insight span",
    ".job-details-fit-level-preferences button",
  ]);

  const experience_level = await textFrom(page, [
    ".job-details-jobs-unified-top-card__job-insight:nth-child(2) span",
  ]);

  let description = null;
  const descLocator = page.locator(".jobs-description__content, #job-details, .jobs-box__html-content").first();
  if (await descLocator.isVisible().catch(() => false)) {
    description = await descLocator.innerText().catch(() => null);
  }

  const applyLink = await page
    .locator('a[href*="/jobs/view/"], a.jobs-apply-button, a[data-control-name="jobdetails_topcard_inapply"]')
    .first()
    .getAttribute("href")
    .catch(() => null);

  const job_url =
    card.job_url ||
    (page.url().includes("/jobs/view/") ? page.url().split("?")[0] : null) ||
    (applyLink?.includes("/jobs/view/")
      ? (applyLink.startsWith("http") ? applyLink : `https://www.linkedin.com${applyLink}`).split("?")[0]
      : null);

  return {
    job_title: job_title || card.job_title,
    company: company || card.company,
    location: location || card.location,
    posted: posted || card.posted,
    job_url,
    job_id: parseJobId(job_url) || card.job_id,
    description,
    employment_type,
    experience_level,
  };
}

module.exports = { extractJobCards, extractJobDetails, parseJobId };
