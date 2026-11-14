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

const STATUS_LABELS = { new: "New", saved: "Saved", applied: "Applied", hidden: "Hidden" };

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
  return url ? `=HYPERLINK("${String(url).replace(/"/g, '""')}","${label}")` : "";
}

function score(value) {
  return Number.isFinite(value) ? value : "";
}

function buildSheetRows(jobs) {
  const rows = [SHEET_HEADERS];
  for (const job of jobs) {
    const resume = job.latest_resume_id && typeof job.latest_resume_id === "object" ? job.latest_resume_id : null;
    rows.push([
      formatIst(job.first_seen_at),
      score(job.match?.score),
      score(job.match?.ats_score),
      text(job.match?.relevancy),
      text(job.company),
      text(job.title),
      text(job.location),
      text(job.source_site || (job.source === "career_page" ? "Career page" : "Web")),
      link(job.job_url, "Apply"),
      text(job.match?.summary),
      link(resume?.drive_url, "Resume PDF"),
      score(resume?.ats_after),
      STATUS_LABELS[job.status] || "",
    ]);
  }
  return rows;
}

module.exports = { buildSheetRows, SHEET_HEADERS, formatIst };
