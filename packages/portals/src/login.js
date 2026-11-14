const PORTAL_META = {
  linkedin: {
    label: "LinkedIn",
    loginUrl: "https://www.linkedin.com/login",
    homeUrl: "https://www.linkedin.com/feed/",
    cookieUrl: "https://www.linkedin.com",
    authCookies: ["li_at"],
    signedInPath: /^https:\/\/(www\.)?linkedin\.com\/(feed|jobs|mynetwork|in\/)/,
    wallPath: /linkedin\.com\/(login|authwall|checkpoint|uas\/login|signup)/,
  },
  naukri: {
    label: "Naukri",
    loginUrl: "https://www.naukri.com/nlogin/login",
    homeUrl: "https://www.naukri.com/mnjuser/homepage",
    cookieUrl: "https://www.naukri.com",
    authCookies: ["nauk_at", "nauk_rt"],
    signedInPath: /^https:\/\/(www\.)?naukri\.com\/mnjuser\//,
    wallPath: /naukri\.com\/(nlogin|login|registration)/,
  },
};

/** Signed in = an auth cookie is set and the user is no longer on a login/2FA page (or is on a signed-in page). */
function isLoggedIn(portal, cookies = [], currentUrl = "") {
  const meta = PORTAL_META[portal];
  if (!meta) return false;
  const url = currentUrl || "";
  if (meta.signedInPath.test(url)) return true;
  return cookies.some((c) => meta.authCookies.includes(c.name) && c.value) && !meta.wallPath.test(url);
}

function isLoginWall(portal, currentUrl = "", bodyText = "") {
  const meta = PORTAL_META[portal];
  if (!meta) return true;
  if (meta.wallPath.test(currentUrl || "")) return true;
  const body = String(bodyText || "").toLowerCase();
  if (portal === "naukri") return body.includes("login to apply") || (body.includes("enter your email") && body.includes("password"));
  return body.includes("sign in to view more jobs") || body.includes("join now to see");
}

module.exports = { PORTAL_META, isLoggedIn, isLoginWall };
