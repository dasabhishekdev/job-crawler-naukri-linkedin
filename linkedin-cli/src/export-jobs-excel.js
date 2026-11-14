const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const root = path.resolve(__dirname, "..");
const defaultInput = path.join(root, "jobs-crawl-export.json");

const args = process.argv.slice(2);
const fineOnly = args.includes("--fine");
const positional = args.filter((arg) => !arg.startsWith("--"));

const inputPath = positional[0] ? path.resolve(positional[0]) : defaultInput;
const defaultOutput = fineOnly
  ? path.join(root, "jobs-fine-export.xlsx")
  : path.join(root, "jobs-crawl-export.xlsx");
const outputPath = positional[1] ? path.resolve(positional[1]) : defaultOutput;

const COLUMN_WIDTHS = [
  { wch: 45 },
  { wch: 28 },
  { wch: 38 },
  { wch: 14 },
  { wch: 52 },
  { wch: 14 },
  { wch: 16 },
  { wch: 18 },
  { wch: 22 },
  { wch: 12 },
  { wch: 50 },
  { wch: 8 },
  { wch: 12 },
  { wch: 12 },
  { wch: 20 },
  { wch: 20 },
  { wch: 80 },
];

function dedupeJobs(jobs) {
  const seen = new Set();
  return jobs.filter((job) => {
    const key = `${(job.company || "").toLowerCase()}|${(job.job_title || "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function filterFineJobs(jobs) {
  return dedupeJobs(jobs).filter((job) => job.url_status === "discovered");
}

function toRow(job) {
  return {
    job_title: job.job_title ?? "",
    company: job.company ?? "",
    location: job.location ?? "",
    posted: job.posted ?? "",
    job_url: job.job_url ?? "",
    job_id: job.job_id ?? "",
    employment_type: job.employment_type ?? "",
    experience_level: job.experience_level ?? "",
    search_keyword: job.search_keyword ?? "",
    match_score: job.match_score ?? "",
    match_reasons: Array.isArray(job.match_reasons)
      ? job.match_reasons.join("; ")
      : job.match_reasons ?? "",
    tier: job.tier ?? "",
    url_status: job.url_status ?? "",
    apply_type: job.apply_type ?? "",
    validated_at: job.validated_at ?? "",
    scraped_at: job.scraped_at ?? "",
    description: job.description ?? "",
  };
}

function writeWorkbook(jobs, data, outputFile) {
  const jobRows = jobs.map(toRow);
  const workbook = XLSX.utils.book_new();
  const jobsSheet = XLSX.utils.json_to_sheet(jobRows);
  jobsSheet["!cols"] = COLUMN_WIDTHS;
  XLSX.utils.book_append_sheet(workbook, jobsSheet, "Jobs");

  if (!Array.isArray(data) && data.summary) {
    const summaryRows = [
      { field: "exported_at", value: data.exported_at ?? "" },
      { field: "location", value: data.location ?? "" },
      { field: "filter", value: fineOnly ? "discovered (deduped)" : "all" },
      { field: "exported_jobs", value: jobRows.length },
      { field: "total", value: data.summary.total ?? "" },
      { field: "valid_open", value: data.summary.valid_open ?? "" },
      { field: "valid_closed", value: data.summary.valid_closed ?? "" },
      { field: "dead", value: data.summary.dead ?? "" },
      { field: "discovered", value: data.summary.discovered ?? "" },
      { field: "error", value: data.summary.error ?? "" },
      { field: "target", value: data.summary.target ?? "" },
      { field: "open_tier_1_2", value: data.summary.open_tier_1_2 ?? "" },
    ];

    const summarySheet = XLSX.utils.json_to_sheet(summaryRows);
    summarySheet["!cols"] = [{ wch: 18 }, { wch: 40 }];
    XLSX.utils.book_append_sheet(workbook, summarySheet, "Summary");
  }

  XLSX.writeFile(workbook, outputFile);
  return jobRows.length;
}

if (!fs.existsSync(inputPath)) {
  console.error(`Input file not found: ${inputPath}`);
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const allJobs = Array.isArray(data) ? data : data.jobs || [];
const jobs = fineOnly ? filterFineJobs(allJobs) : allJobs;
const count = writeWorkbook(jobs, data, outputPath);

const label = fineOnly ? "fine (discovered, deduped)" : "all";
console.log(`Exported ${count} ${label} jobs to ${outputPath}`);
