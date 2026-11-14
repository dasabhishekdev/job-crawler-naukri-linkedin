const mongoose = require("mongoose");

const JOB_SOURCES = ["naukri", "linkedin", "web", "career_page"];

const tailoredResumeSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ["none", "pending", "done", "failed", "skipped"],
      default: "none",
    },
    attempts: { type: Number, default: 0 },
    error: String,
    base_resume: String,
    ats_score: Number,
    filename: String,
    drive_file_id: String,
    drive_url: String,
    folder_url: String,
    created_at: Date,
  },
  { _id: false }
);

const jobSchema = new mongoose.Schema(
  {
    source: { type: String, enum: JOB_SOURCES, required: true, index: true },
    source_site: String,
    dedupe_key: { type: String, index: true },
    first_seen_at: { type: Date, default: Date.now, index: true },
    summary: String,
    relevancy: { type: String, enum: ["High", "Medium", "Low", ""], default: "" },
    fit_score: { type: Number, default: null },
    ats_score: { type: Number, default: null },
    ats_keywords: { type: [String], default: undefined },
    ats_missing: { type: [String], default: undefined },
    scored_at: Date,
    tailored: { type: tailoredResumeSchema, default: undefined },
    job_url: { type: String, required: true },
    job_id: String,
    job_title: String,
    company: String,
    location: String,
    posted: String,
    posted_text: String,
    age_days: Number,
    freshness: { type: String, enum: ["fresh", "stale", "unknown"], default: "unknown" },
    description: String,
    employment_type: String,
    experience_level: String,
    search_keyword: String,
    match_score: { type: Number, default: 0 },
    match_reasons: [String],
    ai_match_score: { type: Number, default: null },
    ai_match_reason: String,
    tier: Number,
    url_status: {
      type: String,
      enum: ["discovered", "valid_open", "valid_closed", "dead", "error"],
      default: "discovered",
      index: true,
    },
    apply_type: { type: String, enum: ["naukri", "easy_apply", "external", "unknown"], default: "unknown" },
    external_apply_url: String,
    application_status: {
      type: String,
      enum: ["pending", "applied", "failed", "skipped", "not_eligible"],
      default: "pending",
    },
    application_error: String,
    applied_at: Date,
    validated_at: Date,
    scraped_at: { type: Date, default: Date.now },
    crawl_run_id: { type: mongoose.Schema.Types.ObjectId, ref: "CrawlRun" },
    candidate_id: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate", index: true },
  },
  { timestamps: true }
);

jobSchema.index({ source: 1, job_url: 1, candidate_id: 1 }, { unique: true });

const crawlRunSchema = new mongoose.Schema(
  {
    source: { type: String, enum: ["naukri", "linkedin", "all", "multi"], default: "all" },
    web_fetched: { type: Number, default: 0 },
    career_fetched: { type: Number, default: 0 },
    new_jobs: { type: Number, default: 0 },
    scored: { type: Number, default: 0 },
    relevant: { type: Number, default: 0 },
    tailored_count: { type: Number, default: 0 },
    sheet_synced: { type: Boolean, default: false },
    multi_stage: String,
    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed", "cancelled"],
      default: "running",
      index: true,
    },
    triggered_by: { type: String, enum: ["manual", "schedule", "agent"], default: "manual" },
    live: { type: Boolean, default: false },
    agent_loop: { type: Boolean, default: false },
    agent_stage: {
      type: String,
      enum: ["idle", "session", "profile", "discover", "rank", "apply", "report"],
      default: "idle",
    },
    agent_status: {
      type: String,
      enum: ["idle", "running", "needs_login", "stopped"],
      default: "idle",
    },
    current_tool: String,
    current_job_title: String,
    cancel_requested: { type: Boolean, default: false },
    target_fresh_jobs: { type: Number, default: 20 },
    discovered: { type: Number, default: 0 },
    validated: { type: Number, default: 0 },
    valid_open: { type: Number, default: 0 },
    stale: { type: Number, default: 0 },
    dead: { type: Number, default: 0 },
    applied: { type: Number, default: 0 },
    apply_failed: { type: Number, default: 0 },
    apply_skipped: { type: Number, default: 0 },
    naukri_fetched: { type: Number, default: 0 },
    linkedin_fetched: { type: Number, default: 0 },
    fresh_found: { type: Number, default: 0 },
    resume_id: { type: mongoose.Schema.Types.ObjectId, ref: "ResumeProfile" },
    candidate_id: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate", index: true },
    fresh_per_keyword_threshold: { type: Number, default: 5 },
    naukri_current_query: String,
    linkedin_current_query: String,
    naukri_queries_used: { type: [String], default: [] },
    linkedin_queries_used: { type: [String], default: [] },
    naukri_fresh_from_query: { type: Number, default: 0 },
    linkedin_fresh_from_query: { type: Number, default: 0 },
    naukri_keyword_source: { type: String, enum: ["ai", "fallback", "selected", ""], default: "" },
    linkedin_keyword_source: { type: String, enum: ["ai", "fallback", "selected", ""], default: "" },
    naukri_planned_queries: { type: [String], default: [] },
    linkedin_planned_queries: { type: [String], default: [] },
    keyword_mode: {
      type: String,
      enum: ["selected_only", "selected_plus_ai", "ai_auto"],
      default: "ai_auto",
    },
    selected_naukri_queries: { type: [String], default: [] },
    selected_linkedin_queries: { type: [String], default: [] },
    openai_prompt_tokens: { type: Number, default: 0 },
    openai_completion_tokens: { type: Number, default: 0 },
    openai_cost_usd: { type: Number, default: 0 },
    profile_updated: { type: Boolean, default: false },
    needs_login: { type: Boolean, default: false },
    error_message: String,
    started_at: { type: Date, default: Date.now },
    finished_at: Date,
  },
  { timestamps: true }
);

const keywordLibrarySchema = new mongoose.Schema(
  {
    text: { type: String, required: true, trim: true },
    platform: {
      type: String,
      enum: ["naukri", "linkedin", "both"],
      required: true,
      index: true,
    },
    source: { type: String, enum: ["ai", "manual"], default: "manual", index: true },
    active: { type: Boolean, default: true, index: true },
    use_count: { type: Number, default: 0 },
    last_used_at: Date,
  },
  { timestamps: true }
);

keywordLibrarySchema.index(
  { platform: 1, text: 1 },
  { unique: true, collation: { locale: "en", strength: 2 } }
);

const crawlLogSchema = new mongoose.Schema(
  {
    crawl_run_id: { type: mongoose.Schema.Types.ObjectId, ref: "CrawlRun", index: true },
    level: { type: String, enum: ["info", "warn", "error"], default: "info" },
    source: String,
    message: { type: String, required: true },
    meta: mongoose.Schema.Types.Mixed,
    created_at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

const applicationSchema = new mongoose.Schema(
  {
    job_id: { type: mongoose.Schema.Types.ObjectId, ref: "Job", required: true },
    candidate_id: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate", index: true },
    source: { type: String, default: "naukri" },
    status: { type: String, enum: ["applied", "failed", "skipped"], required: true },
    resume_file: String,
    error_message: String,
    form_answers: mongoose.Schema.Types.Mixed,
    applied_at: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

const resumeProfileSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    mime_type: String,
    text: { type: String, required: true },
    uploaded_at: { type: Date, default: Date.now },
    is_active: { type: Boolean, default: true, index: true },
    candidate_id: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate", index: true },
  },
  { timestamps: true }
);

const candidateProfileSchema = new mongoose.Schema(
  {
    target_roles: { type: [String], default: [] },
    skills: { type: [String], default: [] },
    locations: { type: [String], default: [] },
    experience_years: { type: Number, default: 0 },
    job_keywords: { type: [String], default: [] },
    search_queries: { type: [String], default: [] },
  },
  { _id: false }
);

const applyPrefsSchema = new mongoose.Schema(
  {
    notice_period: { type: String, default: "" },
    current_ctc: { type: String, default: "" },
    expected_ctc: { type: String, default: "" },
    locations: { type: String, default: "" },
  },
  { _id: false }
);

const careerPageSchema = new mongoose.Schema(
  {
    name: { type: String, default: "" },
    url: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true },
    last_crawled_at: Date,
    last_found: { type: Number, default: 0 },
    last_error: String,
  },
  { _id: true }
);

const driveRefsSchema = new mongoose.Schema(
  {
    root_folder_id: String,
    candidate_folder_id: String,
    tailored_folder_id: String,
    sheet_id: String,
    sheet_url: String,
    last_synced_at: Date,
  },
  { _id: false }
);

const candidateSchema = new mongoose.Schema(
  {
    slug: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    is_active: { type: Boolean, default: false, index: true },
    resume_dir: { type: String, required: true },
    naukri_storage_state: { type: String, required: true },
    linkedin_storage_state: String,
    profile: { type: candidateProfileSchema, default: () => ({}) },
    apply_prefs: { type: applyPrefsSchema, default: () => ({}) },
    max_apply_per_day: { type: Number, default: 20 },
    ai_min_score: { type: Number, default: 70 },
    career_pages: { type: [careerPageSchema], default: [] },
    tailor_base_resumes: { type: [String], default: [] },
    drive: { type: driveRefsSchema, default: () => ({}) },
    last_profile_updated_at: Date,
    resume_id: { type: mongoose.Schema.Types.ObjectId, ref: "ResumeProfile" },
  },
  { timestamps: true }
);

const agentEventSchema = new mongoose.Schema(
  {
    run_id: { type: mongoose.Schema.Types.ObjectId, ref: "CrawlRun", index: true },
    candidate_id: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate", index: true },
    stage: {
      type: String,
      enum: ["session", "profile", "discover", "rank", "apply", "report"],
      required: true,
      index: true,
    },
    tool: String,
    message: { type: String, required: true },
    level: { type: String, enum: ["info", "warn", "error"], default: "info" },
    job_id: { type: mongoose.Schema.Types.ObjectId, ref: "Job" },
    meta: mongoose.Schema.Types.Mixed,
    created_at: { type: Date, default: Date.now, index: true },
  },
  { timestamps: false }
);

const queryYieldSchema = new mongoose.Schema(
  {
    candidate_id: { type: mongoose.Schema.Types.ObjectId, ref: "Candidate", index: true },
    platform: { type: String, enum: ["naukri", "linkedin"], required: true },
    query: { type: String, required: true, trim: true },
    discovered: { type: Number, default: 0 },
    fresh_count: { type: Number, default: 0 },
    applied_count: { type: Number, default: 0 },
    last_used_at: Date,
  },
  { timestamps: true }
);

queryYieldSchema.index({ candidate_id: 1, platform: 1, query: 1 }, { unique: true });

const appSettingsSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    api_key: { type: String, default: "" },
    model: { type: String, default: "gpt-4o" },
    verified_at: { type: Date, default: null },
    available_models: { type: [mongoose.Schema.Types.Mixed], default: [] },
    last_verified_model: { type: String, default: "" },
    data: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true }
);

const Job = mongoose.model("Job", jobSchema);
const CrawlRun = mongoose.model("CrawlRun", crawlRunSchema);
const CrawlLog = mongoose.model("CrawlLog", crawlLogSchema);
const Application = mongoose.model("Application", applicationSchema);
const ResumeProfile = mongoose.model("ResumeProfile", resumeProfileSchema);
const KeywordLibrary = mongoose.model("KeywordLibrary", keywordLibrarySchema);
const Candidate = mongoose.model("Candidate", candidateSchema);
const AgentEvent = mongoose.model("AgentEvent", agentEventSchema);
const QueryYield = mongoose.model("QueryYield", queryYieldSchema);
const AppSettings = mongoose.model("AppSettings", appSettingsSchema);

async function ensureIndexes() {
  try {
    await Job.collection.dropIndex("source_1_job_url_1");
  } catch {
    /* index may not exist on fresh DBs */
  }
}

async function connectDb(uri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  await ensureIndexes();
  return mongoose.connection;
}

module.exports = {
  connectDb,
  JOB_SOURCES,
  Job,
  CrawlRun,
  CrawlLog,
  Application,
  ResumeProfile,
  KeywordLibrary,
  Candidate,
  AgentEvent,
  QueryYield,
  AppSettings,
};
