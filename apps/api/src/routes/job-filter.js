const { loadBlocklist } = require("@jobportal/core");

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildJobFilter(query) {
  const {
    source,
    url_status,
    tier,
    freshness,
    application_status,
    min_score,
    min_ai_score,
    q,
    crawl_run_id,
    candidate_id,
    from,
    to,
    search_keyword,
  } = query;

  const filter = {};
  if (source) filter.source = source;
  if (url_status) filter.url_status = url_status;
  if (tier) filter.tier = Number(tier);
  if (freshness) filter.freshness = freshness;
  if (application_status) filter.application_status = application_status;
  if (candidate_id) filter.candidate_id = candidate_id;
  if (min_score) filter.match_score = { $gte: Number(min_score) };
  if (min_ai_score) filter.ai_match_score = { $gte: Number(min_ai_score) };
  if (crawl_run_id) filter.crawl_run_id = crawl_run_id;
  if (search_keyword) {
    filter.search_keyword = { $regex: String(search_keyword), $options: "i" };
  }
  if (from || to) {
    filter.scraped_at = {};
    if (from) {
      const fromDate = new Date(from);
      if (!Number.isNaN(fromDate.getTime())) filter.scraped_at.$gte = fromDate;
    }
    if (to) {
      const toDate = new Date(to);
      if (!Number.isNaN(toDate.getTime())) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(to))) {
          toDate.setHours(23, 59, 59, 999);
        }
        filter.scraped_at.$lte = toDate;
      }
    }
    if (Object.keys(filter.scraped_at).length === 0) delete filter.scraped_at;
  }
  if (q) {
    filter.$or = [
      { job_title: { $regex: q, $options: "i" } },
      { company: { $regex: q, $options: "i" } },
      { location: { $regex: q, $options: "i" } },
    ];
  }
  const blocklist = loadBlocklist();
  if (blocklist.length) {
    filter.company = { $not: new RegExp(`\\b(${blocklist.map(escapeRegex).join("|")})\\b`, "i") };
  }
  return filter;
}

module.exports = { buildJobFilter };
