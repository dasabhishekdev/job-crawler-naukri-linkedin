const { open, humanDelay, bodyText } = require("../portals/common");
const { detectApplyOutcome, helpReasonFromText } = require("./detect");

const CLICKABLE =
  'button, [role="button"], input[type="button"], input[type="submit"], .jobs-apply-button';
const DIALOG = '[role="dialog"], .jobs-easy-apply-modal';
const MAX_STEPS = 8;

function normalizeLabel(label) {
  return String(label || "")
    .replace(/\s+/g, " ")
    .trim();
}

function isEasyApplyLabel(label) {
  return /easy apply/i.test(normalizeLabel(label));
}

function isExternalApplyLabel(label) {
  const text = normalizeLabel(label);
  if (!text || isEasyApplyLabel(text)) return false;
  return /^apply\b/i.test(text);
}

function isAdvanceLabel(label) {
  return /^(next|continue|review|submit|submit application)$/i.test(normalizeLabel(label));
}

function isAppliedLabel(label) {
  return /^applied$/i.test(normalizeLabel(label));
}

function isLinkedInSuccess(text, { successModal } = {}) {
  const t = String(text || "");
  if (detectApplyOutcome(t, "") === "applied") return true;
  if (/application submitted|your application was sent|you applied\b/i.test(t)) return true;
  if (successModal && /\bdone\b/i.test(t)) return true;
  return false;
}

function fieldVaultKey({ name, label, type, autocomplete } = {}) {
  const hay = `${name || ""} ${label || ""} ${type || ""} ${autocomplete || ""}`.toLowerCase();
  if (String(type || "").toLowerCase() === "email" || /e-?mail/.test(hay)) return "email";
  if (String(type || "").toLowerCase() === "tel" || /phone|mobile|\btel\b/.test(hay)) return "phone";
  if (/\bcity\b/.test(hay) || (/\blocation\b/.test(hay) && !/re-?location|linkedin/.test(hay))) return "city";
  return null;
}

function mapFieldFromVault(field, vault = {}) {
  const key = fieldVaultKey(field);
  if (key === "email") return String(vault.email || "").trim() || null;
  if (key === "phone") return String(vault.phone || "").trim() || null;
  if (key === "city") return String(vault.city || vault.current_location || "").trim() || null;
  return null;
}

function linkedInHelpReason(text, url) {
  const t = String(text || "");
  const href = String(url || "");
  if (/captcha|verify you.?re human/i.test(t)) return "captcha";
  if (/linkedin\.com\/(login|authwall|checkpoint|uas\/login|signup)/i.test(href)) return "checkpoint";
  if (/checkpoint|unusual activity|security (check|challenge)/i.test(t)) return "checkpoint";
  if (detectApplyOutcome(t, href) === "needs_help") return helpReasonFromText(t);
  return null;
}

function normalizeButtons(buttonLabels = []) {
  return buttonLabels
    .map((b) =>
      typeof b === "string"
        ? { label: normalizeLabel(b), enabled: true }
        : { label: normalizeLabel(b?.label), enabled: b?.enabled !== false }
    )
    .filter((b) => b.label);
}

function planLinkedInStep({
  bodyText: text = "",
  url = "",
  buttonLabels = [],
  fields = [],
  fileInputVisible = false,
  fileInputRequired = false,
  successModal = false,
  easyApplyClicked = false,
  vault = {},
  resumePath = "",
  resumeUploaded = false,
} = {}) {
  const buttons = normalizeButtons(buttonLabels);
  const attempted = easyApplyClicked ? { attempted: true } : {};
  const help = linkedInHelpReason(text, url);

  if (isLinkedInSuccess(text, { successModal }) || buttons.some((b) => isAppliedLabel(b.label))) {
    return easyApplyClicked ? { ok: true, attempted: true } : { ok: true };
  }
  if (help) return { ok: false, needsHelp: true, reason: help, ...attempted };

  if (!easyApplyClicked) {
    const easy = buttons.find((b) => isEasyApplyLabel(b.label));
    if (easy) return { action: "click_easy_apply", label: easy.label };
    if (buttons.some((b) => isExternalApplyLabel(b.label))) {
      return { ok: false, needsHelp: true, reason: "not_easy_apply" };
    }
    return { ok: false, failed: true, reason: "no_apply_button" };
  }

  if (fileInputVisible && resumePath && !resumeUploaded) return { action: "upload" };

  const fills = (fields || [])
    .filter((f) => f.empty)
    .map((f) => {
      const value = mapFieldFromVault(f, vault);
      return value ? { name: f.name, label: f.label, value } : null;
    })
    .filter(Boolean);
  if (fills.length) return { action: "fill", fills };

  const blocked = (fields || []).some((f) => {
    if (mapFieldFromVault(f, vault) && f.empty) return false;
    return (f.required && f.empty) || f.ariaInvalid;
  });
  if (blocked || (fileInputVisible && fileInputRequired && !resumePath)) {
    return { ok: false, needsHelp: true, reason: "unmapped_field", attempted: true };
  }

  const advance = buttons.find((b) => isAdvanceLabel(b.label) && b.enabled);
  if (advance) return { action: "next", label: advance.label };

  return { ok: false, failed: true, reason: "unknown_outcome", attempted: true };
}

async function clickableButtons(page) {
  return page
    .evaluate(
      (sel) =>
        [...document.querySelectorAll(sel)]
          .map((el) => ({
            label: (el.innerText || el.value || el.getAttribute("aria-label") || "").replace(/\s+/g, " ").trim(),
            enabled: !el.disabled && el.getAttribute("aria-disabled") !== "true",
          }))
          .filter((b) => b.label),
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
  throw new Error(`LinkedIn apply control not found: ${want}`);
}

async function readDialog(page) {
  const dialog = page.locator(DIALOG).first();
  const visible = await dialog.isVisible({ timeout: 1500 }).catch(() => false);
  if (!visible) return { text: "", visible: false };
  return {
    text: (await dialog.innerText({ timeout: 800 }).catch(() => "")) || "",
    visible: true,
  };
}

async function readFields(page) {
  return page
    .evaluate((dialogSel) => {
      const root = document.querySelector(dialogSel) || document;
      const skip = /^(hidden|submit|button|file)$/i;
      return [...root.querySelectorAll("input, select, textarea")]
        .filter((el) => !skip.test(el.type || ""))
        .map((el) => {
          const type = (el.type || el.tagName).toLowerCase();
          const id = el.id;
          let labelEl = el.closest("label");
          if (!labelEl && id) {
            labelEl = document.querySelector(`label[for="${id.replace(/"/g, '\\"')}"]`);
          }
          const label = (labelEl?.innerText || el.getAttribute("aria-label") || el.placeholder || "")
            .replace(/\s+/g, " ")
            .trim();
          const empty = type === "checkbox" || type === "radio" ? !el.checked : !String(el.value || "").trim();
          return {
            name: el.name || el.id || "",
            label,
            type,
            required: Boolean(el.required) || el.getAttribute("aria-required") === "true",
            empty,
            ariaInvalid: el.getAttribute("aria-invalid") === "true",
          };
        });
    }, DIALOG)
    .catch(() => []);
}

async function fileInputState(page) {
  return page
    .evaluate((dialogSel) => {
      const root = document.querySelector(dialogSel) || document;
      const input = root.querySelector('input[type="file"]');
      if (!input) return { visible: false, required: false };
      return {
        visible: true,
        required: Boolean(input.required) || input.getAttribute("aria-required") === "true",
      };
    }, DIALOG)
    .catch(() => ({ visible: false, required: false }));
}

async function uploadResume(page, resumePath) {
  const input = page.locator(`${DIALOG} input[type="file"], input[type="file"]`).first();
  await input.setInputFiles(resumePath);
}

async function fillFields(page, fills) {
  for (const fill of fills) {
    if (!fill?.name && !fill?.label) continue;
    const nameSel = fill.name
      ? `${DIALOG} [name="${fill.name}"], [name="${fill.name}"]`
      : null;
    const loc = nameSel ? page.locator(nameSel).first() : page.getByLabel(fill.label).first();
    const found = await loc.count().catch(() => 0);
    if (!found) continue;
    await loc.fill(String(fill.value)).catch(async () => {
      await loc.selectOption({ label: String(fill.value) }).catch(() => loc.selectOption({ value: String(fill.value) }).catch(() => {}));
    });
  }
}

async function snapshot(page, { easyApplyClicked, vault, resumePath, resumeUploaded }) {
  const dialog = easyApplyClicked ? await readDialog(page) : { text: "", visible: false };
  const buttons = await clickableButtons(page);
  const file = easyApplyClicked ? await fileInputState(page) : { visible: false, required: false };
  const fields = easyApplyClicked ? await readFields(page) : [];
  const pageText = await bodyText(page);
  const text = [pageText, dialog.text].filter(Boolean).join("\n");
  const successModal =
    Boolean(dialog.visible) &&
    buttons.some((b) => /^done$/i.test(b.label)) &&
    !buttons.some((b) => isAdvanceLabel(b.label));
  return {
    bodyText: text,
    url: page.url(),
    buttonLabels: buttons,
    fields,
    fileInputVisible: file.visible,
    fileInputRequired: file.required,
    successModal,
    easyApplyClicked,
    vault,
    resumePath,
    resumeUploaded,
  };
}

/** LinkedIn Easy Apply: session via open(); Phase 1 fills email/phone/city only. */
async function applyLinkedInEasy({ page, jobUrl, vault, resumePath, log }) {
  await open(page, "linkedin", jobUrl);

  let resumeUploaded = false;
  let decision = planLinkedInStep(await snapshot(page, { easyApplyClicked: false, vault, resumePath, resumeUploaded }));

  if (decision.action === "click_easy_apply") {
    await log?.info?.(`LinkedIn Easy Apply: clicking "${decision.label}"`);
    await clickLabel(page, decision.label);
    await humanDelay(2000, 5000);
    decision = planLinkedInStep(await snapshot(page, { easyApplyClicked: true, vault, resumePath, resumeUploaded }));
  }

  for (let step = 0; step < MAX_STEPS && decision.action; step++) {
    if (decision.action === "upload") {
      await log?.info?.("LinkedIn Easy Apply: uploading resume");
      await uploadResume(page, resumePath)
        .then(() => {
          resumeUploaded = true;
        })
        .catch(() => {});
    } else if (decision.action === "fill") {
      await log?.info?.("LinkedIn Easy Apply: filling contact fields");
      await fillFields(page, decision.fills).catch(() => {});
    } else if (decision.action === "next") {
      await log?.info?.(`LinkedIn Easy Apply: "${decision.label}"`);
      await clickLabel(page, decision.label).catch(() => {});
    } else {
      break;
    }
    await humanDelay(1200, 2800);
    decision = planLinkedInStep(await snapshot(page, { easyApplyClicked: true, vault, resumePath, resumeUploaded }));
  }

  if (decision.action) return { ok: false, failed: true, reason: "unknown_outcome", attempted: true };
  return decision;
}

module.exports = {
  applyLinkedInEasy,
  planLinkedInStep,
  isEasyApplyLabel,
  isExternalApplyLabel,
  isAdvanceLabel,
  isLinkedInSuccess,
  mapFieldFromVault,
};
