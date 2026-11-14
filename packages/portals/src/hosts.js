const COMMON = [
  "accounts.google.com",
  "www.google.com",
  "appleid.apple.com",
  "idmsa.apple.com",
  "recaptcha.net",
  "hcaptcha.com",
  "arkoselabs.com",
  "funcaptcha.com",
];

const PORTAL_HOSTS = {
  linkedin: ["linkedin.com", "licdn.com", ...COMMON],
  naukri: ["naukri.com", "naukimg.com", ...COMMON],
};

function hostMatches(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Whether a top-level navigation (main frame or popup) may proceed inside the login window. */
function isAllowedNavigation(rawUrl, portal) {
  if (rawUrl === "about:blank") return true;
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return (PORTAL_HOSTS[portal] || []).some((domain) => hostMatches(host, domain));
}

module.exports = { isAllowedNavigation, PORTAL_HOSTS };
