const { extractEmails } = require("../utils/email");
const { analyzePost } = require("../matcher");

function parseLead(raw, profile) {
  const analysis = analyzePost(raw.post_text, profile);
  const emails = extractEmails(raw.post_text);

  return {
    post_url: raw.post_url || raw.urn,
    author_name: raw.author_name,
    author_profile: raw.author_profile,
    post_text: raw.post_text,
    posted: raw.posted,
    emails,
    is_job_post: analysis.is_job_post,
    match_score: analysis.match_score,
    match_reasons: analysis.match_reasons,
    source: raw.source || "feed",
    search_query: raw.search_query || null,
  };
}

function isRelevantLead(lead, minMatchScore) {
  return lead.is_job_post && lead.match_score >= minMatchScore;
}

module.exports = { parseLead, isRelevantLead };
