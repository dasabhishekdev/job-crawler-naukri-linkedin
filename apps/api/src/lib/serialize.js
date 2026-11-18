const { AI_PROVIDERS } = require("@jobportal/db");
const { aiReady } = require("@jobportal/ai");
const { googleConfigured } = require("@jobportal/google");
const { isVaultReady, vaultMissingFields } = require("@jobportal/core");

function publicUser(user) {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    avatar_url: user.avatar_url || "",
    role: user.role,
    has_password: Boolean(user.password_hash),
    google_linked: Boolean(user.google_sub),
    must_change_password: Boolean(user.must_change_password),
    created_at: user.createdAt,
  };
}

function publicAi(user) {
  const keys = {};
  for (const provider of AI_PROVIDERS) {
    const k = user.ai?.keys?.[provider];
    keys[provider] = {
      configured: Boolean(k?.ciphertext),
      last4: k?.last4 || "",
      verified_at: k?.verified_at || null,
      error: k?.error || "",
    };
  }
  return { provider: user.ai?.provider || "", models: user.ai?.models || {}, keys, ready: aiReady(user) };
}

function publicGoogle(user) {
  return {
    configured: googleConfigured(),
    connected: Boolean(user.google?.refresh_token),
    email: user.google?.email || "",
    connected_at: user.google?.connected_at || null,
    sheet_url: user.drive?.sheet_url || "",
    last_synced_at: user.drive?.last_synced_at || null,
    last_error: user.drive?.last_error || "",
  };
}

function publicCrawler(user) {
  const c = user.crawler || {};
  return {
    hourly_enabled: Boolean(c.hourly_enabled),
    web_search: c.web_search !== false,
    career_pages: c.career_pages !== false,
    max_job_age_days: c.max_job_age_days,
    searches_per_run: c.searches_per_run,
    jobs_per_search: c.jobs_per_search,
    min_match_to_sheet: c.min_match_to_sheet,
    daily_run_limit: c.daily_run_limit,
    daily_token_budget: c.daily_token_budget ?? 1500000,
    discover_companies: c.discover_companies !== false,
    max_companies: c.max_companies ?? 40,
    career_pages_per_run: c.career_pages_per_run ?? 10,
  };
}

function publicResume(resume) {
  if (!resume) return null;
  return {
    id: String(resume._id),
    filename: resume.filename,
    size: resume.size,
    uploaded_at: resume.createdAt,
    parse_status: resume.parse_status,
    parse_error: resume.parse_error || "",
    text_length: resume.text?.length || 0,
  };
}

function publicVault(vault) {
  const v = vault?.toObject ? vault.toObject() : vault || {};
  return {
    full_name: v.full_name || "",
    email: v.email || "",
    phone: v.phone || "",
    current_location: v.current_location || "",
    linkedin_url: v.linkedin_url || "",
    naukri_url: v.naukri_url || "",
    experience_years: v.experience_years || 0,
    notice_period: v.notice_period || "",
    current_ctc: v.current_ctc || "",
    expected_ctc: v.expected_ctc || "",
    work_authorization: v.work_authorization || "",
    education_summary: v.education_summary || "",
    password_set: Boolean(v.password_set),
    match_threshold: v.match_threshold ?? 70,
    auto_apply_enabled: Boolean(v.auto_apply_enabled),
    daily_attempt_cap: v.daily_attempt_cap ?? 20,
    ready: isVaultReady(v),
    missing_fields: vaultMissingFields(v),
  };
}

function publicApplication(doc) {
  const jobDoc = doc.job_id && typeof doc.job_id === "object" && doc.job_id.title !== undefined ? doc.job_id : null;
  return {
    id: String(doc._id),
    job_id: String(jobDoc?._id || doc.job_id),
    status: doc.status,
    portal_kind: doc.portal_kind,
    attempts: doc.attempts || 0,
    last_error: doc.last_error || "",
    help_reason: doc.help_reason || "",
    screenshot_refs: doc.screenshot_refs || [],
    applied_at: doc.applied_at || null,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
    ...(jobDoc
      ? {
          job: {
            id: String(jobDoc._id),
            title: jobDoc.title,
            company: jobDoc.company,
            job_url: jobDoc.job_url,
            source: jobDoc.source,
            status: jobDoc.status,
          },
        }
      : {}),
  };
}

module.exports = { publicUser, publicAi, publicGoogle, publicCrawler, publicResume, publicVault, publicApplication };
