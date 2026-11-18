const { open, humanDelay, bodyText } = require("../portals/common");
const { detectApplyOutcome, isNaukriHost, helpReasonFromText } = require("./detect");

const CLICKABLE =
  'button, [role="button"], input[type="button"], input[type="submit"], #apply-button, [class*="apply-button"], [class*="applyButton"]';
const DIALOG = '[role="dialog"], .modal, [class*="chatbot"], [class*="apply-popup"], [class*="applyPopup"]';

function normalizeLabel(label) {
  return String(label || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isCompanySiteLabel(label) {
  return /apply on company/i.test(normalizeLabel(label));
}

function isEasyApplyLabel(label) {
  const text = normalizeLabel(label);
  if (!text || isCompanySiteLabel(text)) return false;
  return /easy apply|apply now|^apply$/i.test(text);
}

function isConfirmLabel(label) {
  const text = normalizeLabel(label);
  if (!text || isCompanySiteLabel(text)) return false;
  return /^(confirm|submit|send application)$/i.test(text);
}

function isComplexApplyForm(text, html = "") {
  const body = String(text || "");
  const markup = String(html || "");
  if (/application sent|applied successfully|already applied/i.test(body)) return false;
  if (/chatbot|naukri assistant|chat with|answer (a few|the following) question/i.test(body)) return true;
  const requiredFreeText = (markup.match(/<(textarea|input)[^>]*>/gi) || []).filter((tag) => {
    if (!/\brequired\b/i.test(tag)) return false;
    if (/^<textarea/i.test(tag)) return true;
    if (/type=["']hidden["']/i.test(tag) || /type=["'](submit|button|checkbox|radio|file)["']/i.test(tag)) return false;
    return /type=["']text["']/i.test(tag) || !/\btype=/i.test(tag);
  });
  return requiredFreeText.length >= 1;
}

function decideNaukriApply({
  bodyText: text,
  url,
  buttonLabels = [],
  modalText = "",
  modalHtml = "",
  applyClicked = false,
}) {
  const labels = buttonLabels.map(normalizeLabel).filter(Boolean);
  const outcome = detectApplyOutcome(text, url);

  if (!applyClicked) {
    if (outcome === "applied") return { ok: true };
    if (outcome === "needs_help") return { ok: false, needsHelp: true, reason: helpReasonFromText(text) };
    const easy = labels.find(isEasyApplyLabel);
    if (easy) return { action: "click", label: easy };
    if (labels.some(isCompanySiteLabel)) return { ok: false, needsHelp: true, reason: "not_easy_apply" };
    return { ok: false, failed: true, reason: "no_apply_button" };
  }

  if (outcome === "applied") return { ok: true, attempted: true };
  if (!isNaukriHost(url)) return { ok: false, needsHelp: true, reason: "external_apply", attempted: true };
  const complex =
    modalText || modalHtml
      ? isComplexApplyForm(modalText || text, modalHtml)
      : /chatbot|naukri assistant/i.test(String(text || ""));
  if (complex) return { ok: false, needsHelp: true, reason: "complex_form", attempted: true };
  if (outcome === "needs_help") {
    return { ok: false, needsHelp: true, reason: helpReasonFromText(text), attempted: true };
  }
  const confirm = labels.find(isConfirmLabel);
  if (confirm) return { action: "confirm", label: confirm, attempted: true };
  if (modalText || modalHtml) {
    const applyAgain = labels.find(isEasyApplyLabel);
    if (applyAgain) return { action: "confirm", label: applyAgain, attempted: true };
  }
  return { ok: false, failed: true, reason: "unknown_outcome", attempted: true };
}

async function clickableLabels(page) {
  return page
    .evaluate(
      (sel) =>
        [...document.querySelectorAll(sel)]
          .map((el) => (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim())
          .filter(Boolean),
      CLICKABLE
    )
    .catch(() => []);
}

async function controlText(el) {
  return (
    normalizeLabel(await el.innerText({ timeout: 400 }).catch(() => "")) ||
    normalizeLabel(await el.getAttribute("value").catch(() => "")) ||
    normalizeLabel(await el.getAttribute("aria-label").catch(() => ""))
  );
}

async function clickLabel(page, label) {
  const want = normalizeLabel(label);
  const loc = page.locator(CLICKABLE);
  const count = await loc.count().catch(() => 0);
  for (let i = 0; i < count; i++) {
    const el = loc.nth(i);
    if ((await controlText(el)) === want) {
      await el.click({ timeout: 4000 });
      return;
    }
  }
  throw new Error(`Naukri apply control not found: ${want}`);
}

async function readDialog(page) {
  const dialog = page.locator(DIALOG).first();
  const visible = await dialog.isVisible({ timeout: 1500 }).catch(() => false);
  if (!visible) return { text: "", html: "" };
  return {
    text: (await dialog.innerText({ timeout: 800 }).catch(() => "")) || "",
    html: (await dialog.innerHTML().catch(() => "")) || "",
  };
}

async function skipChatPrompts(page) {
  for (let i = 0; i < 3; i++) {
    const skip = page.locator('button:has-text("Skip"), a:has-text("Skip")').first();
    const visible = await skip.isVisible({ timeout: 600 }).catch(() => false);
    if (!visible) break;
    await skip.click({ timeout: 1500 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
  }
}

async function snapshot(page, applyClicked) {
  const dialog = applyClicked ? await readDialog(page) : { text: "", html: "" };
  return {
    bodyText: await bodyText(page),
    url: page.url(),
    buttonLabels: await clickableLabels(page),
    modalText: dialog.text,
    modalHtml: dialog.html,
    applyClicked,
  };
}

/** Naukri Easy Apply: one-click / confirm only; complex chat → needs_help. */
async function applyNaukriEasy({ page, jobUrl, log }) {
  await open(page, "naukri", jobUrl);

  let decision = decideNaukriApply(await snapshot(page, false));
  if (decision.action === "click") {
    await log?.info?.(`Naukri Easy Apply: clicking "${decision.label}"`);
    await clickLabel(page, decision.label);
    await humanDelay(2000, 5000);
    await skipChatPrompts(page);
    decision = decideNaukriApply(await snapshot(page, true));
  }

  if (decision.action === "confirm") {
    await log?.info?.(`Naukri Easy Apply: confirming "${decision.label}"`);
    await clickLabel(page, decision.label).catch(() => {});
    await humanDelay(1500, 3000);
    decision = decideNaukriApply(await snapshot(page, true));
  }

  if (decision.action) return { ok: false, failed: true, reason: "unknown_outcome", attempted: true };
  return decision;
}

module.exports = {
  applyNaukriEasy,
  decideNaukriApply,
  isEasyApplyLabel,
  isCompanySiteLabel,
  isComplexApplyForm,
};
