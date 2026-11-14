const test = require("node:test");
const assert = require("node:assert/strict");
const { isAllowedNavigation } = require("../src/hosts");
const { isLoggedIn, isLoginWall } = require("../src/login");
const { validateInput } = require("../src/input");
const { contextOptions } = require("../src/viewport");
const { linkedinSearchUrl, naukriSearchUrl, extractLinkedInJobIds, extractNaukriJobLinks } = require("../src/urls");
const { parseJobPostingJsonLd } = require("../src/jsonld");
const { hashToken } = require("../src/tickets");

test("navigation allowlist covers the portals, SSO and captcha hosts only", () => {
  assert.equal(isAllowedNavigation("https://www.linkedin.com/login", "linkedin"), true);
  assert.equal(isAllowedNavigation("https://accounts.google.com/o/oauth2/auth", "linkedin"), true);
  assert.equal(isAllowedNavigation("https://client-api.arkoselabs.com/x", "linkedin"), true);
  assert.equal(isAllowedNavigation("https://www.naukri.com/nlogin/login", "naukri"), true);
  assert.equal(isAllowedNavigation("https://www.naukri.com/nlogin/login", "linkedin"), false);
  assert.equal(isAllowedNavigation("https://evil.example/linkedin.com", "linkedin"), false);
  assert.equal(isAllowedNavigation("https://linkedin.com.evil.example/", "linkedin"), false);
  assert.equal(isAllowedNavigation("https://sites.google.com/view/phish", "linkedin"), false);
  assert.equal(isAllowedNavigation("about:blank", "linkedin"), true);
  assert.equal(isAllowedNavigation("javascript:alert(1)", "linkedin"), false);
  assert.equal(isAllowedNavigation("file:///etc/passwd", "naukri"), false);
});

test("login detection uses auth cookies or signed-in URLs", () => {
  assert.equal(isLoggedIn("linkedin", [{ name: "li_at", value: "x", domain: ".linkedin.com" }], "https://www.linkedin.com/feed/"), true);
  assert.equal(
    isLoggedIn("linkedin", [{ name: "li_at", value: "x", domain: ".linkedin.com" }], "https://www.linkedin.com/checkpoint/challenge/x"),
    false,
    "2FA challenge still in progress"
  );
  assert.equal(isLoggedIn("linkedin", [{ name: "bcookie", value: "x", domain: ".linkedin.com" }], "https://www.linkedin.com/login"), false);
  assert.equal(isLoggedIn("naukri", [], "https://www.naukri.com/mnjuser/homepage"), true);
  assert.equal(isLoggedIn("naukri", [{ name: "nauk_at", value: "t", domain: ".naukri.com" }], "https://www.naukri.com/"), true);
  assert.equal(isLoggedIn("naukri", [{ name: "nauk_at", value: "", domain: ".naukri.com" }], "https://www.naukri.com/nlogin/login"), false);
});

test("login walls are recognised from URL and page text", () => {
  assert.equal(isLoginWall("linkedin", "https://www.linkedin.com/authwall?trk=x"), true);
  assert.equal(isLoginWall("linkedin", "https://www.linkedin.com/checkpoint/challenge"), true);
  assert.equal(isLoginWall("linkedin", "https://www.linkedin.com/jobs/collections/recommended/"), false);
  assert.equal(isLoginWall("naukri", "https://www.naukri.com/nlogin/login?URL=x"), true);
  assert.equal(isLoginWall("naukri", "https://www.naukri.com/mnjuser/homepage", "Login to apply. Enter your email and password"), true);
  assert.equal(isLoginWall("naukri", "https://www.naukri.com/mnjuser/homepage", "Recommended jobs for you"), false);
});

test("validateInput accepts only safe, in-bounds commands", () => {
  const vp = { width: 390, height: 780 };
  assert.deepEqual(validateInput({ t: "tap", x: 10.4, y: 20 }, vp), { t: "tap", x: 10.4, y: 20 });
  assert.equal(validateInput({ t: "tap", x: -1, y: 20 }, vp), null);
  assert.equal(validateInput({ t: "tap", x: 9999, y: 20 }, vp), null);
  assert.deepEqual(validateInput({ t: "scroll", x: 5, y: 5, dy: 5000 }, vp), { t: "scroll", x: 5, y: 5, dy: 1500 });
  assert.deepEqual(validateInput({ t: "text", text: "hello" }, vp), { t: "text", text: "hello" });
  assert.equal(validateInput({ t: "text", text: "x".repeat(501) }, vp), null);
  assert.deepEqual(validateInput({ t: "key", key: "Enter" }, vp), { t: "key", key: "Enter" });
  assert.equal(validateInput({ t: "key", key: "Control+Shift+I" }, vp), null);
  assert.deepEqual(validateInput({ t: "back" }, vp), { t: "back" });
  assert.equal(validateInput({ t: "eval", code: "1" }, vp), null);
  assert.equal(validateInput("nope", vp), null);
});

test("contextOptions emulates phones and clamps sizes", () => {
  const phone = contextOptions({ width: 2000, height: 100, mobile: true });
  assert.equal(phone.isMobile, true);
  assert.equal(phone.hasTouch, true);
  assert.deepEqual(phone.viewport, { width: 480, height: 560 });
  assert.match(phone.userAgent, /Mobile/);
  const desktop = contextOptions({ mobile: false });
  assert.deepEqual(desktop.viewport, { width: 1280, height: 800 });
  assert.equal(desktop.isMobile, false);
  assert.equal(desktop.acceptDownloads, false);
});

test("portal URL builders and link extractors", () => {
  const li = new URL(linkedinSearchUrl("Procurement Analyst", "Bengaluru"));
  assert.equal(li.searchParams.get("keywords"), "Procurement Analyst");
  assert.equal(li.searchParams.get("location"), "Bengaluru");
  assert.equal(li.searchParams.get("f_TPR"), "r604800");
  assert.equal(li.searchParams.get("sortBy"), "DD");
  assert.equal(naukriSearchUrl("Supply Chain Analyst", "Bengaluru, Karnataka", 2.4), "https://www.naukri.com/supply-chain-analyst-jobs-in-bengaluru?experience=2&jobAge=7");
  assert.deepEqual(
    extractLinkedInJobIds([
      "https://www.linkedin.com/jobs/view/4012345678/?trk=x",
      "/jobs/view/4012345678",
      "https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4099999999",
      "https://www.linkedin.com/company/acme",
    ]),
    ["4012345678", "4099999999"]
  );
  assert.deepEqual(
    extractNaukriJobLinks([
      "https://www.naukri.com/job-listings-procurement-executive-acme-bengaluru-2-to-4-years-141124001234?src=jobsearchDesk",
      "https://www.naukri.com/job-listings-procurement-executive-acme-bengaluru-2-to-4-years-141124001234",
      "https://www.naukri.com/acme-jobs-careers-123",
    ]),
    ["https://www.naukri.com/job-listings-procurement-executive-acme-bengaluru-2-to-4-years-141124001234"]
  );
});

test("parseJobPostingJsonLd reads schema.org JobPosting", () => {
  const job = parseJobPostingJsonLd([
    '{"@type":"BreadcrumbList"}',
    JSON.stringify({
      "@context": "https://schema.org",
      "@type": "JobPosting",
      title: "Procurement Executive",
      hiringOrganization: { "@type": "Organization", name: "Acme Pvt Ltd" },
      jobLocation: [{ address: { addressLocality: "Bengaluru", addressRegion: "Karnataka" } }],
      datePosted: "2026-11-10",
      description: "<p>Manage <b>vendors</b></p>",
      experienceRequirements: { monthsOfExperience: 24 },
    }),
  ]);
  assert.equal(job.title, "Procurement Executive");
  assert.equal(job.company, "Acme Pvt Ltd");
  assert.equal(job.location, "Bengaluru, Karnataka");
  assert.equal(job.posted, "2026-11-10");
  assert.equal(job.description, "Manage vendors");
  assert.equal(parseJobPostingJsonLd(["not json"]), null);
  const graph = parseJobPostingJsonLd([JSON.stringify({ "@graph": [{ "@type": "JobPosting", title: "Buyer" }] })]);
  assert.equal(graph.title, "Buyer");
});

test("tickets are stored hashed", () => {
  assert.equal(hashToken("abc").length, 64);
  assert.notEqual(hashToken("abc"), "abc");
});
