const test = require("node:test");
const assert = require("node:assert/strict");
const { extractFromHtml } = require("../src/crawl/enrich");

test("extractFromHtml prefers JobPosting structured data", () => {
  const html = `<html><head><title>Buyer | Acme</title>
    <script type="application/ld+json">{"@type":"JobPosting","title":"Buyer","hiringOrganization":{"name":"Acme"},
    "jobLocation":{"address":{"addressLocality":"Bengaluru"}},"datePosted":"2026-11-10","description":"<p>Manage <b>vendors</b> and POs</p>"}</script>
    </head><body><main>Other text</main></body></html>`;
  assert.deepEqual(extractFromHtml(html), {
    title: "Buyer",
    company: "Acme",
    location: "Bengaluru",
    posted: "2026-11-10",
    valid_through: "",
    description: "Manage vendors and POs",
    expired: false,
  });
});

test("extractFromHtml marks closed postings as expired", () => {
  const html = `<html><body><main><h1>Buyer</h1><p>This job is no longer available. The position has been filled.</p></main></body></html>`;
  assert.equal(extractFromHtml(html).expired, true);
});

test("extractFromHtml falls back to the main content without scripts or navigation", () => {
  const html = `<html><head><meta name="description" content="Short summary"></head><body>
    <nav>Home Jobs About</nav><script>var x = 1;</script><style>.a{}</style>
    <main><h1>Supply Chain Analyst</h1><p>Analyse fill rates &amp; inventory.</p></main><footer>© Acme</footer></body></html>`;
  const out = extractFromHtml(html);
  assert.equal(out.title, "Supply Chain Analyst");
  assert.match(out.description, /Analyse fill rates & inventory/);
  assert.doesNotMatch(out.description, /var x|Home Jobs|© Acme/);
});
