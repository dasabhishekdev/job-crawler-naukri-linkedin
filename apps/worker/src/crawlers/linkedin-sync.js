const Database = require("better-sqlite3");
const fs = require("fs");
const { Job } = require("@jobportal/db");
const { analyzeJob, assignTier, classifyFreshness } = require("@jobportal/core");
const { incrementCrawlProgress } = require("../progress");

function mapLinkedInStatus(urlStatus) {
  const map = {
    discovered: "discovered",
    valid_open: "valid_open",
    valid_closed: "valid_closed",
    dead: "dead",
    error: "error",
  };
  return map[urlStatus] || "discovered";
}

async function syncLinkedInJobs({ dbPath, profile, config, runId, log }) {
  if (!fs.existsSync(dbPath)) {
    await log.warn(`LinkedIn jobs.db not found at ${dbPath}`);
    return { synced: 0 };
  }

  const db = new Database(dbPath, { readonly: true });
  const rows = db
    .prepare(
      `SELECT * FROM jobs ORDER BY match_score DESC, scraped_at DESC LIMIT 500`
    )
    .all();
  db.close();

  let synced = 0;

  for (const row of rows) {
    const postedText = row.posted || "";
    const { freshness, age_days } = classifyFreshness(postedText, config.maxJobAgeDays);
    const matchReasons = JSON.parse(row.match_reasons || "[]");

    const doc = {
      source: "linkedin",
      job_url: row.job_url,
      job_id: row.job_id,
      job_title: row.job_title,
      company: row.company,
      location: row.location,
      posted: row.posted,
      posted_text: postedText,
      age_days,
      freshness,
      description: row.description,
      employment_type: row.employment_type,
      experience_level: row.experience_level,
      search_keyword: row.search_keyword,
      match_score: row.match_score || 0,
      match_reasons: matchReasons,
      tier: row.tier || assignTier(row.match_score || 0, config.tier1MinScore, config.tier2MinScore),
      url_status: mapLinkedInStatus(row.url_status),
      apply_type: row.apply_type || "unknown",
      validated_at: row.validated_at ? new Date(row.validated_at) : null,
      scraped_at: row.scraped_at ? new Date(row.scraped_at) : new Date(),
      crawl_run_id: runId,
      application_status: "not_eligible",
    };

    if (!row.match_score && row.description) {
      const analysis = analyzeJob(
        [row.job_title, row.company, row.location, row.description].filter(Boolean).join(" "),
        profile,
        row.search_keyword
      );
      doc.match_score = analysis.match_score;
      doc.match_reasons = analysis.match_reasons;
      doc.tier = assignTier(analysis.match_score, config.tier1MinScore, config.tier2MinScore);
    }

    await Job.findOneAndUpdate(
      { source: "linkedin", job_url: row.job_url },
      { $set: doc },
      { upsert: true }
    );
    synced += 1;

    if (runId) {
      await incrementCrawlProgress(runId, {
        linkedin_fetched: 1,
        discovered: 1,
        valid_open: doc.url_status === "valid_open" ? 1 : 0,
      });
    }
  }

  await log.info(`Synced ${synced} LinkedIn jobs from jobhunter DB`);
  return { synced };
}

module.exports = { syncLinkedInJobs };
