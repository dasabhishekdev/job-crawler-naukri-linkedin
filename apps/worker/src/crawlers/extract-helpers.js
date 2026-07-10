const { delay } = require("../utils");

async function textFromLocator(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 400 }).catch(() => false)) {
      const text = await locator.textContent().catch(() => null);
      if (text?.trim()) return text.trim();
    }
  }
  return null;
}

async function clickFirstVisible(page, selectors) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.isVisible({ timeout: 400 }).catch(() => false)) {
      await locator.click({ timeout: 2000 }).catch(() => {});
      await delay(600);
      return true;
    }
  }
  return false;
}

async function expandLinkedInDescription(page) {
  await clickFirstVisible(page, [
    "button.show-more-less-html__button--more",
    'button[aria-label*="Show more"]',
    'button[aria-label*="See more"]',
    'button[aria-label*="see more"]',
    'button:has-text("Show more")',
    'button:has-text("See more")',
    'button:has-text("show more")',
  ]);
}

async function expandNaukriDescription(page) {
  await clickFirstVisible(page, [
    'button:has-text("Read more")',
    'span:has-text("Read more")',
    "a.read-more",
    "span.read-more",
    '[class*="read-more"]',
    'button:has-text("View more")',
  ]);
}

function parseExperienceLevel(...parts) {
  const text = parts.filter(Boolean).join(" ").toLowerCase();
  if (!text) return null;

  if (/\b(fresher|entry level|0\s*[-–]\s*1\s*year|internship)\b/.test(text)) {
    return "Entry level";
  }

  const range = text.match(/(\d+)\s*[-–to]+\s*(\d+)\s*(?:\+?\s*)?years?/i);
  if (range) return `${range[1]}-${range[2]} years`;

  const plus = text.match(/(\d+)\+\s*years?/i);
  if (plus) return `${plus[1]}+ years`;

  const single = text.match(/(\d+)\s*years?/i);
  if (single) return `${single[1]} years`;

  if (/\b(senior|lead|manager|director|head)\b/.test(text)) return "Senior";

  return null;
}

function splitCompanyLocation(raw) {
  if (!raw) return { company: null, location: null };
  const parts = raw
    .split(/[·•|]/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length >= 2) {
    return { company: parts[0], location: parts.slice(1).join(", ") };
  }
  return { company: raw.trim(), location: null };
}

module.exports = {
  textFromLocator,
  clickFirstVisible,
  expandLinkedInDescription,
  expandNaukriDescription,
  parseExperienceLevel,
  splitCompanyLocation,
};
