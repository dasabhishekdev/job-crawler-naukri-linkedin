const fs = require("fs");
const path = require("path");

const { pickLatestResumeUploadPath } = require("@jobportal/agent");

function slugify(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function buildSearchUrl(keyword, location, experience) {
  const k = encodeURIComponent(keyword);
  const l = encodeURIComponent(location);
  const slug = `${slugify(keyword)}-jobs-in-${slugify(location)}`;
  return `https://www.naukri.com/${slug}?k=${k}&l=${l}&experience=${experience}`;
}

function parseJobId(url) {
  const match = (url || "").match(/(\d{10,})(?:\?|$)/);
  return match ? match[1] : null;
}

function findResumePdf(resumeDir) {
  return pickLatestResumeUploadPath(resumeDir);
}

function readResumeContext(resumeDir) {
  if (!fs.existsSync(resumeDir)) return "";
  const mdFiles = fs
    .readdirSync(resumeDir)
    .filter((f) => f.endsWith(".md"))
    .slice(0, 3);
  return mdFiles
    .map((f) => fs.readFileSync(path.join(resumeDir, f), "utf8"))
    .join("\n\n")
    .slice(0, 8000);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, { retries = 3, delayMs = 2000, onRetry } = {}) {
  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        if (onRetry) await onRetry(attempt, err);
        await delay(delayMs * attempt);
      }
    }
  }
  throw lastErr;
}

module.exports = {
  slugify,
  buildSearchUrl,
  parseJobId,
  findResumePdf,
  readResumeContext,
  delay,
  withRetry,
};
