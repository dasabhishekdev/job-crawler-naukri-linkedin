const Database = require("better-sqlite3");
const config = require("../config");

let db;

function migrate(db) {
  const columns = db.pragma("table_info(leads)").map((c) => c.name);
  if (!columns.includes("source")) {
    db.exec("ALTER TABLE leads ADD COLUMN source TEXT DEFAULT 'feed'");
  }
  if (!columns.includes("search_query")) {
    db.exec("ALTER TABLE leads ADD COLUMN search_query TEXT");
  }
}

function getDb() {
  if (!db) {
    db = new Database(config.dbPath);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS leads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        post_url TEXT UNIQUE,
        author_name TEXT,
        author_profile TEXT,
        post_text TEXT,
        posted TEXT,
        emails TEXT,
        is_job_post INTEGER,
        match_score INTEGER,
        match_reasons TEXT,
        source TEXT DEFAULT 'feed',
        search_query TEXT,
        scraped_at TEXT DEFAULT (datetime('now'))
      )
    `);
    migrate(db);
  }
  return db;
}

function leadExists(postUrl) {
  const row = getDb()
    .prepare("SELECT 1 FROM leads WHERE post_url = ?")
    .get(postUrl);
  return Boolean(row);
}

function saveLead(lead) {
  const stmt = getDb().prepare(`
    INSERT OR IGNORE INTO leads (
      post_url, author_name, author_profile, post_text, posted,
      emails, is_job_post, match_score, match_reasons, source, search_query
    ) VALUES (
      @post_url, @author_name, @author_profile, @post_text, @posted,
      @emails, @is_job_post, @match_score, @match_reasons, @source, @search_query
    )
  `);

  const result = stmt.run({
    post_url: lead.post_url,
    author_name: lead.author_name || null,
    author_profile: lead.author_profile || null,
    post_text: lead.post_text || null,
    posted: lead.posted || null,
    emails: JSON.stringify(lead.emails || []),
    is_job_post: lead.is_job_post ? 1 : 0,
    match_score: lead.match_score || 0,
    match_reasons: JSON.stringify(lead.match_reasons || []),
    source: lead.source || "feed",
    search_query: lead.search_query || null,
  });

  return result.changes > 0;
}

function getLeadCount() {
  const row = getDb().prepare("SELECT COUNT(*) AS count FROM leads").get();
  return row.count;
}

function getLeadsWithEmails() {
  return getDb()
    .prepare(
      `SELECT * FROM leads
       WHERE emails != '[]' AND emails IS NOT NULL
       ORDER BY match_score DESC, scraped_at DESC`
    )
    .all();
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = {
  leadExists,
  saveLead,
  getLeadCount,
  getLeadsWithEmails,
  closeDb,
};
