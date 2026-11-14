const fs = require("fs");
const path = require("path");
const config = require("./config");
const {
  getValidOpenJobs,
  getStatusCounts,
  getTierCounts,
  getValidOpenCount,
  closeJobsDb,
} = require("./storage/jobs-db");

const root = path.resolve(__dirname, "..");
const outPath = path.join(root, "jobs-export.json");
const urlsPath = path.join(root, "jobs-urls.txt");
const reportPath = path.join(root, "jobs-report.txt");

const jobs = getValidOpenJobs().map((row) => ({
  job_title: row.job_title,
  company: row.company,
  location: row.location,
  posted: row.posted,
  job_url: row.job_url,
  job_id: row.job_id,
  employment_type: row.employment_type,
  experience_level: row.experience_level,
  search_keyword: row.search_keyword,
  match_score: row.match_score,
  match_reasons: JSON.parse(row.match_reasons || "[]"),
  tier: row.tier,
  url_status: row.url_status,
  apply_type: row.apply_type,
  validated_at: row.validated_at,
  description: row.description,
  scraped_at: row.scraped_at,
}));

fs.writeFileSync(outPath, JSON.stringify(jobs, null, 2));
fs.writeFileSync(urlsPath, jobs.map((j) => j.job_url).join("\n") + (jobs.length ? "\n" : ""));

const statusCounts = getStatusCounts();
const tierCounts = getTierCounts();
const openCount = getValidOpenCount();
const shortfall = Math.max(0, config.targetJobs - openCount);
const tierMap = Object.fromEntries(tierCounts.map((r) => [`tier_${r.tier}`, r.count]));

const report = [
  "Jobs Crawl Report",
  "=================",
  `Generated: ${new Date().toISOString()}`,
  "",
  `Validated open jobs (tier 1+2): ${openCount} / ${config.targetJobs} target`,
  shortfall > 0 ? `Shortfall: ${shortfall} jobs` : "Target met.",
  "",
  "Tier breakdown (valid_open):",
  `  Tier 1 (profile-matched): ${tierMap.tier_1 || 0}`,
  `  Tier 2 (keyword-only):    ${tierMap.tier_2 || 0}`,
  "",
  "Status breakdown (all jobs in DB):",
  `  valid_open:   ${statusCounts.valid_open || 0}`,
  `  valid_closed: ${statusCounts.valid_closed || 0}`,
  `  dead:         ${statusCounts.dead || 0}`,
  `  discovered:   ${statusCounts.discovered || 0}`,
  `  error:        ${statusCounts.error || 0}`,
  "",
  `Exported: ${jobs.length} jobs → jobs-export.json`,
  `URLs:     jobs-urls.txt`,
].join("\n");

fs.writeFileSync(reportPath, report + "\n");

console.log(report);
closeJobsDb();
