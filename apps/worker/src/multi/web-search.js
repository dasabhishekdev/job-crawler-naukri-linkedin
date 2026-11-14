const { runCursorAgent } = require("./cursor-agent");
const { extractJsonArray } = require("./normalize");

const ROLES_PER_BATCH = 3;

function rolesForProfile(profile) {
  const seen = new Set();
  const roles = [];
  for (const role of [...(profile.target_roles || []), ...(profile.search_queries || [])]) {
    const clean = String(role || "")
      .replace(/\b(opening|openings|jobs?)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    if (clean && !seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase());
      roles.push(clean);
    }
  }
  return roles;
}

/** Rotates through the role list so consecutive hourly runs cover different roles. */
function buildRoleBatches(profile, { maxBatches = 3, rotation = 0 } = {}) {
  const roles = rolesForProfile(profile);
  if (!roles.length) return [];
  const total = Math.min(maxBatches * ROLES_PER_BATCH, roles.length);
  const start = (rotation * total) % roles.length;
  const picked = Array.from({ length: total }, (_, i) => roles[(start + i) % roles.length]);
  const batches = [];
  for (let i = 0; i < picked.length; i += ROLES_PER_BATCH) {
    batches.push(picked.slice(i, i + ROLES_PER_BATCH));
  }
  return batches;
}

function webSearchPrompt({ roles, profile, location, blocklist, maxAgeDays, perBatch }) {
  return `You are a job researcher. Use web search (and open pages when needed) to find up to ${perBatch} CURRENTLY OPEN job postings.

Candidate: ${profile.name || "candidate"}, ~${profile.experience_years || 2} years experience.
Key skills: ${(profile.skills || []).slice(0, 15).join(", ")}
Target roles for this search: ${roles.join("; ")}
Location: ${location} only (on-site or hybrid in this city).
Posted within the last ${maxAgeDays} days when the posting shows a date.
${blocklist.length ? `Exclude these companies: ${blocklist.join(", ")}.` : ""}

Search broadly: company career pages (Workday, Greenhouse, Lever, SuccessFactors, iCIMS, custom sites), Indeed, Foundit, Instahyre, iimjobs, Hirist, apna, Shine, Glassdoor, Cutshort, Wellfound. LinkedIn and Naukri are crawled separately, so prefer other sources.
Only include postings that match the target roles and experience level. Use the most direct apply URL (prefer the company's own posting).

Return ONLY a JSON array (no prose). Each item:
{"title":"","company":"","location":"","apply_url":"","source_site":"","posted":"date or relative text, empty if unknown","experience":"","description":"key responsibilities and requirements, max 1200 characters"}`;
}

async function searchWebJobs({ profile, location, blocklist, maxAgeDays = 14, maxBatches = 3, perBatch = 8, rotation = 0, log }) {
  const batches = buildRoleBatches(profile, { maxBatches, rotation });
  const settled = await Promise.allSettled(
    batches.map(async (roles) => {
      const text = await runCursorAgent(
        webSearchPrompt({ roles, profile, location, blocklist, maxAgeDays, perBatch }),
        { log }
      );
      const jobs = extractJsonArray(text);
      await log.info(`Web agent found ${jobs.length} jobs for: ${roles.join(", ")}`);
      return jobs.map((job) => ({ ...job, source: "web", discovery_query: roles.join("; ") }));
    })
  );

  const jobs = [];
  for (const [i, outcome] of settled.entries()) {
    if (outcome.status === "fulfilled") jobs.push(...outcome.value);
    else await log.warn(`Web agent batch failed (${batches[i].join(", ")}): ${outcome.reason?.message}`);
  }
  return jobs;
}

module.exports = { searchWebJobs, buildRoleBatches, rolesForProfile };
