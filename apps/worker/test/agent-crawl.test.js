const test = require("node:test");
const assert = require("node:assert/strict");
const { pickJobLinks } = require("../src/crawl/career-site");
const { isDeadStatus } = require("../src/crawl/enrich");
const { normalizeCompanies, registrableDomain, careersLinkFromHtml } = require("../src/crawl/companies");

test("pickJobLinks keeps same-site or ATS job links whose title or path fits the profile", () => {
  const anchors = [
    { href: "https://careers.acme.com/jobs/123-procurement-analyst", text: "Procurement Analyst" },
    { href: "https://careers.acme.com/jobs/124-software-engineer", text: "Software Engineer" },
    { href: "https://careers.acme.com/about", text: "About us" },
    { href: "https://careers.acme.com/jobs", text: "All jobs" },
    { href: "https://acme.darwinbox.in/ms/candidate/careers/a1b2", text: "Supply Chain Executive" },
    { href: "https://facebook.com/acme/jobs/1", text: "Procurement on Facebook" },
    { href: "https://careers.acme.com/jobs/123-procurement-analyst#apply", text: "Apply" },
    { href: "https://careers.acme.com/position/9/vendor-manager", text: "" },
  ];
  const links = pickJobLinks(anchors, { pageUrl: "https://careers.acme.com/jobs", tokens: ["procurement", "supply", "vendor"] });
  assert.deepEqual(links.map((l) => l.url), [
    "https://careers.acme.com/jobs/123-procurement-analyst",
    "https://acme.darwinbox.in/ms/candidate/careers/a1b2",
    "https://careers.acme.com/position/9/vendor-manager",
  ]);
});

test("isDeadStatus only treats gone pages as dead", () => {
  assert.equal(isDeadStatus(404), true);
  assert.equal(isDeadStatus(410), true);
  assert.equal(isDeadStatus(403), false);
  assert.equal(isDeadStatus(200), false);
  assert.equal(isDeadStatus(0), false);
});

test("registrableDomain groups subdomains of the same company", () => {
  assert.equal(registrableDomain("https://careers.swiggy.com/#/careers"), "swiggy.com");
  assert.equal(registrableDomain("https://www.tata.co.in/careers"), "tata.co.in");
  assert.equal(registrableDomain("not a url"), "");
});

test("normalizeCompanies cleans AI output and skips companies already known", () => {
  const out = normalizeCompanies(
    [
      { name: "Zepto", careers_url: "https://www.zeptonow.com/careers", why: "quick commerce" },
      { name: "Swiggy", careers_url: "https://careers.swiggy.com/" },
      { name: "Blinkit", careers_url: "javascript:void(0)" },
      { name: "Zepto Again", careers_url: "https://zeptonow.com/jobs" },
      { name: "", careers_url: "https://x.com" },
    ],
    { knownDomains: new Set(["swiggy.com"]), knownNames: new Set(["flipkart"]) }
  );
  assert.deepEqual(out.map((c) => c.name), ["Zepto"]);
  assert.equal(out[0].domain, "zeptonow.com");
});

test("normalizeCompanies accepts a company website when the careers URL is unknown", () => {
  const out = normalizeCompanies([{ name: "Udaan", careers_url: "", website: "https://udaan.com" }]);
  assert.deepEqual(out, [{ name: "Udaan", url: "", website: "https://udaan.com", domain: "udaan.com", why: "" }]);
});

test("careersLinkFromHtml finds the careers link on a company homepage", () => {
  const html = `<a href="/about">About</a><a href="https://twitter.com/acme/careers">X</a>
    <a href="/en/join-us">Join our team</a><a href="https://acme.darwinbox.in/ms/candidate/careers">Careers</a>`;
  assert.equal(careersLinkFromHtml(html, "https://acme.com/"), "https://acme.darwinbox.in/ms/candidate/careers");
  assert.equal(careersLinkFromHtml(`<a href="/jobs">Open roles</a>`, "https://acme.com/"), "https://acme.com/jobs");
  assert.equal(careersLinkFromHtml(`<a href="/blog">Blog</a>`, "https://acme.com/"), "");
});
