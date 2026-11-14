const MOBILE_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function clamp(value, min, max, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

/** Playwright context options for a login window that matches the user's device. */
function contextOptions({ width, height, mobile } = {}) {
  const base = {
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    acceptDownloads: false,
    permissions: [],
    serviceWorkers: "block",
  };
  if (mobile) {
    return {
      ...base,
      viewport: { width: clamp(width, 320, 480, 390), height: clamp(height, 560, 960, 780) },
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
      userAgent: MOBILE_UA,
    };
  }
  return { ...base, viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1, userAgent: DESKTOP_UA };
}

module.exports = { contextOptions, DESKTOP_UA, MOBILE_UA };
