const config = require("../config");
const { delay } = require("../utils/delay");
const { SessionExpiredError, gotoWithRetry } = require("./search");

const CLOSED_SIGNALS = [
  "no longer accepting applications",
  "no longer accepting applicants",
];

const DEAD_SIGNALS = [
  "job no longer available",
  "page not found",
  "this job is no longer available",
];

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

async function detectApplyType(page) {
  const easyApply = page.locator(
    'button:has-text("Easy Apply"), button[aria-label*="Easy Apply"]'
  ).first();
  if (await easyApply.isVisible().catch(() => false)) {
    return "easy_apply";
  }

  const externalApply = page.locator(
    'a.jobs-apply-button, a[data-control-name="jobdetails_topcard_inapply"], a:has-text("Apply")'
  ).first();
  if (await externalApply.isVisible().catch(() => false)) {
    const href = await externalApply.getAttribute("href").catch(() => "");
    if (href && !href.includes("linkedin.com/jobs")) {
      return "external";
    }
    return "easy_apply";
  }

  return "unknown";
}

async function extractDetailsFromPage(page) {
  const job_title = await textFrom(page, [
    ".job-details-jobs-unified-top-card__job-title",
    "h1.t-24",
    "h1",
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
  const descLocator = page
    .locator(".jobs-description__content, #job-details, .jobs-box__html-content")
    .first();
  if (await descLocator.isVisible().catch(() => false)) {
    description = await descLocator.innerText().catch(() => null);
  }

  return {
    job_title,
    company,
    location,
    posted,
    employment_type,
    experience_level,
    description,
  };
}

function classifyFromText(bodyText) {
  const lower = (bodyText || "").toLowerCase();

  if (CLOSED_SIGNALS.some((s) => lower.includes(s))) {
    return "valid_closed";
  }
  if (DEAD_SIGNALS.some((s) => lower.includes(s))) {
    return "dead";
  }

  return null;
}

async function validateJobUrl(page, jobUrl) {
  await gotoWithRetry(page, jobUrl);
  await delay(config.validateDelayMs);

  if (page.url().includes("/login") || page.url().includes("/authwall")) {
    throw new SessionExpiredError();
  }

  const bodyText = await page.locator("body").innerText().catch(() => "");
  const presetStatus = classifyFromText(bodyText);

  const details = await extractDetailsFromPage(page);
  const apply_type = await detectApplyType(page);

  if (presetStatus) {
    return { url_status: presetStatus, apply_type, details };
  }

  const hasTitle = Boolean(details.job_title);
  const lower = bodyText.toLowerCase();
  const hasApplySignal =
    apply_type !== "unknown" ||
    lower.includes("apply") ||
    lower.includes("easy apply");

  if (hasTitle && hasApplySignal) {
    return { url_status: "valid_open", apply_type, details };
  }

  if (hasTitle) {
    return { url_status: "valid_open", apply_type, details };
  }

  return { url_status: "dead", apply_type: "unknown", details };
}

module.exports = {
  validateJobUrl,
  classifyFromText,
  CLOSED_SIGNALS,
  DEAD_SIGNALS,
};
