const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema(
  {
    source: { type: String, enum: ["naukri", "linkedin"], required: true, index: true },
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
  },
  { timestamps: true }
);

jobSchema.index({ source: 1, job_url: 1 }, { unique: true });

const crawlRunSchema = new mongoose.Schema(
  {
    source: { type: String, enum: ["naukri", "linkedin", "all"], default: "all" },
    status: {
      type: String,
      enum: ["queued", "running", "completed", "failed", "cancelled"],
      default: "running",
      index: true,
    },
    triggered_by: { type: String, enum: ["manual"], default: "manual" },
    live: { type: Boolean, default: false },
    cancel_requested: { type: Boolean, default: false },
    target_fresh_jobs: { type: Number, default: 20 },
    discovered: { type: Number, default: 0 },
    validated: { type: Number, default: 0 },
    valid_open: { type: Number, default: 0 },
    stale: { type: Number, default: 0 },
    dead: { type: Number, default: 0 },
    applied: { type: Number, default: 0 },
    apply_failed: { type: Number, default: 0 },
    naukri_fetched: { type: Number, default: 0 },
    linkedin_fetched: { type: Number, default: 0 },
    fresh_found: { type: Number, default: 0 },
    resume_id: { type: mongoose.Schema.Types.ObjectId, ref: "ResumeProfile" },
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
    source: { type: String, default: "naukri" },
    status: { type: String, enum: ["applied", "failed", "skipped"], required: true },
    resume_file: String,
    error_message: String,
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
  },
  { timestamps: true }
);

const Job = mongoose.model("Job", jobSchema);
const CrawlRun = mongoose.model("CrawlRun", crawlRunSchema);
const CrawlLog = mongoose.model("CrawlLog", crawlLogSchema);
const Application = mongoose.model("Application", applicationSchema);
const ResumeProfile = mongoose.model("ResumeProfile", resumeProfileSchema);
const KeywordLibrary = mongoose.model("KeywordLibrary", keywordLibrarySchema);

async function connectDb(uri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri);
  return mongoose.connection;
}

module.exports = {
  connectDb,
  Job,
  CrawlRun,
  CrawlLog,
  Application,
  ResumeProfile,
  KeywordLibrary,
};
