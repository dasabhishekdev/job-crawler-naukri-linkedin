function stripHtml(html) {
  return String(html || "")
    .replace(/<(br|\/p|\/li|\/h\d|\/div)[^>]*>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

function findJobPosting(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  const type = node["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return node;
  return findJobPosting(node["@graph"]);
}

function locationOf(jobLocation) {
  const first = Array.isArray(jobLocation) ? jobLocation[0] : jobLocation;
  const address = first?.address || {};
  return [address.addressLocality, address.addressRegion].filter(Boolean).join(", ");
}

/** Extracts a JobPosting from the page's ld+json script contents, or null. */
function parseJobPostingJsonLd(scriptTexts) {
  for (const text of scriptTexts || []) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      continue;
    }
    const job = findJobPosting(data);
    if (!job) continue;
    const months = Number(job.experienceRequirements?.monthsOfExperience);
    return {
      title: String(job.title || "").trim(),
      company: String(job.hiringOrganization?.name || "").trim(),
      location: locationOf(job.jobLocation),
      posted: job.datePosted || "",
      description: stripHtml(job.description).slice(0, 6000),
      experience: Number.isFinite(months) && months > 0 ? `${Math.round(months / 12)}+ years` : "",
    };
  }
  return null;
}

module.exports = { parseJobPostingJsonLd, stripHtml };
