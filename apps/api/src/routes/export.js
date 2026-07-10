const express = require("express");
const XLSX = require("xlsx");
const { Job } = require("@jobportal/db");
const { buildJobFilter } = require("./job-filter");

const router = express.Router();

router.get("/excel", async (req, res) => {
  try {
    const filter = buildJobFilter(req.query);
    const jobs = await Job.find(filter).sort("-match_score").lean();

    const rows = jobs.map((job) => ({
      source: job.source,
      job_title: job.job_title || "",
      company: job.company || "",
      location: job.location || "",
      posted: job.posted || job.posted_text || "",
      freshness: job.freshness || "",
      age_days: job.age_days ?? "",
      job_url: job.job_url || "",
      match_score: job.match_score ?? "",
      match_reasons: (job.match_reasons || []).join("; "),
      tier: job.tier ?? "",
      url_status: job.url_status || "",
      apply_type: job.apply_type || "",
      application_status: job.application_status || "",
      search_keyword: job.search_keyword || "",
      crawl_run_id: job.crawl_run_id ? String(job.crawl_run_id) : "",
      scraped_at: job.scraped_at || "",
      validated_at: job.validated_at || "",
      applied_at: job.applied_at || "",
    }));

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.json_to_sheet(rows);
    sheet["!cols"] = [
      { wch: 10 }, { wch: 40 }, { wch: 25 }, { wch: 30 }, { wch: 15 },
      { wch: 10 }, { wch: 8 }, { wch: 55 }, { wch: 10 }, { wch: 45 },
      { wch: 6 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 20 },
      { wch: 26 }, { wch: 20 }, { wch: 20 }, { wch: 20 },
    ];
    XLSX.utils.book_append_sheet(workbook, sheet, "Jobs");

    const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
    const source = req.query.source || "all";
    const filename = `jobs-export-${source}-${Date.now()}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
