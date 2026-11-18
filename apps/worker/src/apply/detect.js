const APPLIED_RE = /application sent|applied successfully|you have already applied|already applied/i;
const NEEDS_HELP_RE = /captcha|otp|enter (the )?otp|verify mobile|unusual activity|checkpoint/i;

function detectApplyOutcome(bodyText, url) {
  const text = String(bodyText || "");
  const href = String(url || "");
  if (APPLIED_RE.test(text)) return "applied";
  if (NEEDS_HELP_RE.test(text) || /checkpoint/i.test(href)) return "needs_help";
  return "unknown";
}

function isNaukriHost(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "naukri.com" || host.endsWith(".naukri.com");
  } catch {
    return false;
  }
}

function helpReasonFromText(text) {
  const t = String(text || "");
  if (/captcha/i.test(t)) return "captcha";
  if (/otp|enter (the )?otp|verify mobile/i.test(t)) return "otp";
  if (/unusual activity|checkpoint/i.test(t)) return "checkpoint";
  return "checkpoint";
}

module.exports = { detectApplyOutcome, isNaukriHost, helpReasonFromText };
