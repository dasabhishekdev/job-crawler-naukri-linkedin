const { getBrowser } = require("../browser");

function esc(text) {
  return String(text || "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function section(title, body) {
  return body ? `<section><h2>${esc(title)}</h2>${body}</section>` : "";
}

function bullets(items) {
  const list = (items || []).filter(Boolean);
  return list.length ? `<ul>${list.map((b) => `<li>${esc(b)}</li>`).join("")}</ul>` : "";
}

function resumeHtml(resume) {
  const skills = (resume.skills || [])
    .filter((g) => g.items?.length)
    .map((g) => `<p class="skill"><strong>${esc(g.label)}:</strong> ${esc(g.items.join(", "))}</p>`)
    .join("");
  const experience = (resume.experience || [])
    .map(
      (job) => `<div class="job">
  <div class="row"><strong>${esc(job.company)}</strong><span>${esc(job.location)}</span></div>
  <div class="row"><em>${esc(job.title)}</em><span>${esc(job.dates)}</span></div>
  ${bullets(job.bullets)}
</div>`
    )
    .join("");
  const education = (resume.education || []).map((e) => `<p>${esc(e)}</p>`).join("");
  const extras = (resume.extras || []).map((e) => `<p>${esc(e)}</p>`).join("");

  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(resume.name)} Resume</title>
<style>
  @page { size: A4; margin: 14mm 15mm; }
  body { font-family: Calibri, Carlito, "Liberation Sans", Arial, sans-serif; font-size: 10.5pt; color: #111; line-height: 1.32; margin: 0; }
  header { text-align: center; margin-bottom: 6px; }
  h1 { font-size: 19pt; margin: 0; letter-spacing: 0.5px; }
  .contact { font-size: 9.5pt; margin: 2px 0; }
  .headline { font-weight: 700; font-size: 11pt; margin-top: 3px; }
  h2 { font-size: 10.5pt; letter-spacing: 1px; text-transform: uppercase; border-bottom: 1px solid #333; padding-bottom: 1px; margin: 10px 0 4px; }
  p { margin: 2px 0; }
  ul { margin: 2px 0 4px 16px; padding: 0; }
  li { margin: 1px 0; }
  .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
  .row > span { white-space: nowrap; flex-shrink: 0; }
  .job { margin-bottom: 5px; }
  .skill { margin: 2px 0; }
</style></head><body>
<header>
  <h1>${esc(resume.name)}</h1>
  <p class="contact">${esc(resume.contact_line)}</p>
  ${resume.headline ? `<p class="headline">${esc(resume.headline)}</p>` : ""}
</header>
${section("Professional Summary", resume.summary ? `<p>${esc(resume.summary)}</p>` : "")}
${section("Professional Highlights", bullets(resume.highlights))}
${section("Skills", skills)}
${section("Work Experience", experience)}
${section("Education", education)}
${extras}
</body></html>`;
}

/** Renders the structured resume to an A4 PDF buffer in the worker's shared Chromium. */
async function renderResumePdf(resume) {
  const browser = await getBrowser();
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.setContent(resumeHtml(resume), { waitUntil: "load" });
    return await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await context.close().catch(() => {});
  }
}

module.exports = { renderResumePdf, resumeHtml };
