const { analyzeJob, assignTier, classifyFreshness } = require("@jobportal/core");

/**
 * URL status reflects whether the posting is reachable/open — not posting age.
 * Age is stored separately in `freshness` (fresh | stale | unknown).
 */
function resolveUrlStatus({ dead = false, closed = false, hasContent = false }) {
  if (dead) return "dead";
  if (closed) return "valid_closed";
  if (hasContent) return "valid_open";
  return "discovered";
}

function enrichJobRecord(listing, detail, profile, config) {
  const postedText =
    detail.posted || detail.posted_text || listing.posted || listing.posted_text;
  const { freshness, age_days } = classifyFreshness(postedText, config.maxJobAgeDays);

  const job_title = detail.job_title || listing.job_title;
  const company = detail.company || listing.company;
  const location = detail.location || listing.location;
  const description = detail.description || listing.description;

  const url_status = resolveUrlStatus({
    dead: Boolean(detail.dead),
    closed: Boolean(detail.closed),
    hasContent: Boolean(job_title || description),
  });

  const text = [
    job_title,
    company,
    location,
    detail.experience_level || listing.experience_level,
    detail.employment_type || listing.employment_type,
    description,
  ]
    .filter(Boolean)
    .join(" ");

  const analysis = analyzeJob(text, profile, listing.search_keyword);
  const tier = assignTier(analysis.match_score, config.tier1MinScore, config.tier2MinScore);

  return {
    ...listing,
    ...detail,
    job_title,
    company,
    location,
    description,
    posted_text: postedText,
    freshness,
    age_days,
    url_status,
    match_score: analysis.match_score,
    match_reasons: analysis.match_reasons,
    tier,
    validated_at: new Date(),
  };
}

function buildRawListingRecord(listing, profile, config, errorMessage) {
  const postedText = listing.posted || listing.posted_text;
  const { freshness, age_days } = classifyFreshness(postedText, config.maxJobAgeDays);

  const text = [
    listing.job_title,
    listing.company,
    listing.location,
    listing.experience_level,
  ]
    .filter(Boolean)
    .join(" ");

  const analysis = analyzeJob(text, profile, listing.search_keyword);

  return {
    ...listing,
    posted_text: postedText,
    freshness,
    age_days,
    url_status: listing.job_title ? "valid_open" : "discovered",
    match_score: analysis.match_score,
    match_reasons: errorMessage
      ? [...(analysis.match_reasons || []), `scrape_partial: ${errorMessage}`]
      : analysis.match_reasons,
    tier: assignTier(analysis.match_score, config.tier1MinScore, config.tier2MinScore),
    validated_at: new Date(),
  };
}

function isFreshOpen(job) {
  return job.freshness === "fresh" && job.url_status === "valid_open";
}

module.exports = {
  resolveUrlStatus,
  enrichJobRecord,
  buildRawListingRecord,
  isFreshOpen,
};
