const { isLoginWall, PORTAL_META } = require("@jobportal/portals");

class SessionExpiredError extends Error {
  constructor(portal) {
    super(`${PORTAL_META[portal]?.label || portal} session expired. Reconnect it in Settings.`);
    this.name = "SessionExpiredError";
    this.portal = portal;
  }
}

function humanDelay(min = 2500, max = 5000) {
  return new Promise((r) => setTimeout(r, min + Math.random() * (max - min)));
}

async function bodyText(page) {
  return (await page.locator("body").innerText({ timeout: 3000 }).catch(() => "")) || "";
}

/** Navigates and throws SessionExpiredError if the portal shows a login wall. */
async function open(page, portal, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
  if (isLoginWall(portal, page.url(), await bodyText(page))) throw new SessionExpiredError(portal);
}

async function scrollAll(page, rounds = 4) {
  for (let i = 0; i < rounds; i++) {
    await page
      .evaluate(() => {
        window.scrollBy(0, window.innerHeight);
        for (const el of document.querySelectorAll("*")) {
          const style = getComputedStyle(el);
          if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight + 50) el.scrollTop += el.clientHeight;
        }
      })
      .catch(() => {});
    await new Promise((r) => setTimeout(r, 900));
  }
}

async function collectHrefs(page) {
  return page
    .evaluate(() => {
      const out = [...document.querySelectorAll("a[href]")].map((a) => a.href);
      for (const el of document.querySelectorAll("[data-job-id],[data-occludable-job-id]")) {
        const id = el.getAttribute("data-job-id") || el.getAttribute("data-occludable-job-id");
        if (/^\d{6,}$/.test(id || "")) out.push(`/jobs/view/${id}`);
      }
      return out;
    })
    .catch(() => []);
}

async function jsonLdScripts(page) {
  return page.$$eval('script[type="application/ld+json"]', (nodes) => nodes.map((n) => n.textContent || "")).catch(() => []);
}

async function firstText(page, selectors) {
  for (const selector of selectors) {
    const text = await page
      .locator(selector)
      .first()
      .innerText({ timeout: 800 })
      .catch(() => "");
    if (text && text.trim()) return text.trim();
  }
  return "";
}

module.exports = { SessionExpiredError, humanDelay, open, scrollAll, collectHrefs, jsonLdScripts, firstText, bodyText };
