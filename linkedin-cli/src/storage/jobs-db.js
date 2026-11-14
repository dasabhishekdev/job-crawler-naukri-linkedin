const Database = require("better-sqlite3");
const config = require("../config");

let db;

function migrate(database) {
  const columns = database.pragma("table_info(jobs)").map((c) => c.name);
  const additions = [
    ["tier", "INTEGER"],
    ["url_status", "TEXT DEFAULT 'discovered'"],
    ["apply_type", "TEXT"],
    ["validation_attempts", "INTEGER DEFAULT 0"],
    ["validated_at", "TEXT"],
  ];

  for (const [name, type] of additions) {
    if (!columns.includes(name)) {
      database.exec(`ALTER TABLE jobs ADD COLUMN ${name} ${type}`);
    }
  }

  database.exec(`
    UPDATE jobs SET url_status = 'discovered'
    WHERE url_status IS NULL OR url_status = ''
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS crawl_pages (
      location TEXT NOT NULL,
      keyword TEXT NOT NULL,
      page_offset INTEGER NOT NULL,
      completed_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (location, keyword, page_offset)
    )
  `);
}

function getDb() {
  if (!db) {
    db = new Database(config.jobsDbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_title TEXT,
        company TEXT,
        location TEXT,
        posted TEXT,
        job_url TEXT UNIQUE,
        job_id TEXT,
        description TEXT,
        employment_type TEXT,
        experience_level TEXT,
        search_keyword TEXT,
        match_score INTEGER DEFAULT 0,
        match_reasons TEXT,
        tier INTEGER,
        url_status TEXT DEFAULT 'discovered',
        apply_type TEXT,
        validation_attempts INTEGER DEFAULT 0,
        validated_at TEXT,
        scraped_at TEXT DEFAULT (datetime('now'))
      )
    `);
    migrate(db);
  }
  return db;
}

function jobExists(jobUrl) {
  return Boolean(getDb().prepare("SELECT 1 FROM jobs WHERE job_url = ?").get(jobUrl));
}

function saveDiscoveredJob(job) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO jobs (
      job_title, company, location, posted, job_url, job_id,
      search_keyword, url_status
    ) VALUES (
      @job_title, @company, @location, @posted, @job_url, @job_id,
      @search_keyword, 'discovered'
    )
  `);

  const result = stmt.run({
    job_title: job.job_title || null,
    company: job.company || null,
    location: job.location || null,
    posted: job.posted || null,
    job_url: job.job_url,
    job_id: job.job_id || null,
    search_keyword: job.search_keyword || null,
  });

  return result.changes > 0;
}

function updateJobValidation(jobUrl, fields) {
  const stmt = getDb().prepare(`
    UPDATE jobs SET
      job_title = COALESCE(@job_title, job_title),
      company = COALESCE(@company, company),
      location = COALESCE(@location, location),
      posted = COALESCE(@posted, posted),
      description = COALESCE(@description, description),
      employment_type = COALESCE(@employment_type, employment_type),
      experience_level = COALESCE(@experience_level, experience_level),
      match_score = @match_score,
      match_reasons = @match_reasons,
      tier = @tier,
      url_status = @url_status,
      apply_type = @apply_type,
      validation_attempts = @validation_attempts,
      validated_at = datetime('now')
    WHERE job_url = @job_url
  `);

  stmt.run({
    job_url: jobUrl,
    job_title: fields.job_title ?? null,
    company: fields.company ?? null,
    location: fields.location ?? null,
    posted: fields.posted ?? null,
    description: fields.description ?? null,
    employment_type: fields.employment_type ?? null,
    experience_level: fields.experience_level ?? null,
    match_score: fields.match_score ?? 0,
    match_reasons: JSON.stringify(fields.match_reasons || []),
    tier: fields.tier ?? null,
    url_status: fields.url_status,
    apply_type: fields.apply_type ?? null,
    validation_attempts: fields.validation_attempts ?? 0,
  });
}

function getJobsNeedingValidation(limit = 50) {
  return getDb()
    .prepare(
      `SELECT * FROM jobs
       WHERE url_status IN ('discovered', 'error')
         AND validation_attempts < ?
       ORDER BY scraped_at ASC
       LIMIT ?`
    )
    .all(config.maxValidationAttempts, limit);
}

function getValidOpenCount() {
  return getDb()
    .prepare(
      `SELECT COUNT(*) AS count FROM jobs
       WHERE url_status = 'valid_open' AND tier IN (1, 2)`
    )
    .get().count;
}

function getStatusCounts() {
  const rows = getDb()
    .prepare(
      `SELECT url_status, COUNT(*) AS count FROM jobs GROUP BY url_status`
    )
    .all();
  const counts = { discovered: 0, valid_open: 0, valid_closed: 0, dead: 0, error: 0 };
  for (const row of rows) {
    counts[row.url_status] = row.count;
  }
  return counts;
}

function getTierCounts() {
  return getDb()
    .prepare(
      `SELECT tier, COUNT(*) AS count FROM jobs
       WHERE url_status = 'valid_open' AND tier IN (1, 2)
       GROUP BY tier`
    )
    .all();
}

function isPageCompleted(location, keyword, pageOffset) {
  const row = getDb()
    .prepare(
      `SELECT 1 FROM crawl_pages
       WHERE location = ? AND keyword = ? AND page_offset = ?`
    )
    .get(location, keyword, pageOffset);
  return Boolean(row);
}

function markPageCompleted(location, keyword, pageOffset) {
  getDb()
    .prepare(
      `INSERT OR REPLACE INTO crawl_pages (location, keyword, page_offset, completed_at)
       VALUES (?, ?, ?, datetime('now'))`
    )
    .run(location, keyword, pageOffset);
}

function getValidOpenJobs() {
  return getDb()
    .prepare(
      `SELECT * FROM jobs
       WHERE url_status = 'valid_open' AND tier IN (1, 2)
       ORDER BY tier ASC, match_score DESC, scraped_at DESC`
    )
    .all();
}

function getAllJobs() {
  return getDb()
    .prepare("SELECT * FROM jobs ORDER BY match_score DESC, scraped_at DESC")
    .all();
}

function closeJobsDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  jobExists,
  saveDiscoveredJob,
  updateJobValidation,
  getJobsNeedingValidation,
  getValidOpenCount,
  getStatusCounts,
  getTierCounts,
  isPageCompleted,
  markPageCompleted,
  getValidOpenJobs,
  getAllJobs,
  closeJobsDb,
};
