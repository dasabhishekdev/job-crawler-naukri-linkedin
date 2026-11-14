function slug(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function linkedinSearchUrl(role, city) {
  const params = new URLSearchParams({ keywords: role, location: city || "India", f_TPR: "r604800", sortBy: "DD" });
  return `https://www.linkedin.com/jobs/search/?${params}`;
}

function linkedinJobUrl(id) {
  return `https://www.linkedin.com/jobs/view/${id}/`;
}

const LINKEDIN_RECOMMENDED_URL = "https://www.linkedin.com/jobs/collections/recommended/";
const NAUKRI_RECOMMENDED_URL = "https://www.naukri.com/mnjuser/recommendedjobs";

function naukriSearchUrl(role, city, experienceYears) {
  const cityPart = slug(String(city || "").split(",")[0]);
  const path = cityPart ? `${slug(role)}-jobs-in-${cityPart}` : `${slug(role)}-jobs`;
  const params = new URLSearchParams({ jobAge: "7" });
  if (Number.isFinite(Number(experienceYears))) params.set("experience", String(Math.floor(Number(experienceYears))));
  params.sort();
  return `https://www.naukri.com/${path}?${params}`;
}

function extractLinkedInJobIds(hrefs) {
  const ids = [];
  for (const href of hrefs || []) {
    const s = String(href || "");
    const m = s.match(/\/jobs\/view\/(\d{6,})/) || s.match(/[?&]currentJobId=(\d{6,})/);
    if (m && !ids.includes(m[1])) ids.push(m[1]);
  }
  return ids;
}

function extractNaukriJobLinks(hrefs) {
  const links = [];
  for (const href of hrefs || []) {
    let url;
    try {
      url = new URL(String(href || ""), "https://www.naukri.com");
    } catch {
      continue;
    }
    if (!/(^|\.)naukri\.com$/.test(url.hostname) || !url.pathname.startsWith("/job-listings-")) continue;
    const clean = `https://www.naukri.com${url.pathname}`;
    if (!links.includes(clean)) links.push(clean);
  }
  return links;
}

module.exports = {
  linkedinSearchUrl,
  linkedinJobUrl,
  naukriSearchUrl,
  extractLinkedInJobIds,
  extractNaukriJobLinks,
  LINKEDIN_RECOMMENDED_URL,
  NAUKRI_RECOMMENDED_URL,
};
