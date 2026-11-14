const SHEET_HEADERS = [
  "Added (IST)",
  "Match %",
  "ATS %",
  "Relevancy",
  "Company",
  "Job Title",
  "Location",
  "Source",
  "Apply Link",
  "Summary",
  "Tailored Resume",
  "Tailored ATS %",
  "Status",
];

const SOURCE_LABELS = {
  naukri: "Naukri",
  linkedin: "LinkedIn",
  web: "Web",
  career_page: "Career page",
};

const STATUS_LABELS = {
  pending: "New",
  applied: "Applied",
  failed: "Apply failed",
  skipped: "Skipped",
  not_eligible: "Not eligible",
};

function formatIst(date) {
  if (!date) return "";
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Asia/Kolkata",
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value])
  );
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute}`;
}

function text(value) {
  const s = String(value ?? "");
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

function link(url, label) {
  if (!url) return "";
  return `=HYPERLINK("${String(url).replace(/"/g, '""')}","${label}")`;
}

function score(value) {
  return Number.isFinite(value) ? value : "";
}

function jobAddedAt(job) {
  return job.first_seen_at || job.createdAt || job.scraped_at;
}

function buildSheetRows(jobs) {
  const rows = [SHEET_HEADERS];
  for (const job of jobs) {
    const sourceLabel = SOURCE_LABELS[job.source] || job.source || "";
    rows.push([
      formatIst(jobAddedAt(job)),
      score(job.fit_score ?? job.ai_match_score),
      score(job.ats_score),
      text(job.relevancy),
      text(job.company),
      text(job.job_title),
      text(job.location),
      text(job.source_site || sourceLabel),
      link(job.external_apply_url || job.job_url, "Apply"),
      text(job.summary || job.ai_match_reason),
      link(job.tailored?.drive_url, "Resume PDF"),
      score(job.tailored?.ats_score),
      STATUS_LABELS[job.application_status] || "",
    ]);
  }
  return rows;
}

module.exports = { buildSheetRows, SHEET_HEADERS, formatIst, jobAddedAt };
