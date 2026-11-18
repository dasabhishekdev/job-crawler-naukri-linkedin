const mongoose = require("mongoose");

const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const AI_PROVIDERS = ["cursor", "openai"];
const PORTALS = ["linkedin", "naukri"];
const JOB_SOURCES = ["web", "career_page", ...PORTALS];
const RUN_KINDS = ["parse_resume", "crawl", "generate_resume", "portal_crawl", "naukri_refresh", "auto_apply"];
const RUN_STATUSES = ["queued", "running", "completed", "failed", "cancelled"];
const LOG_TAGS = ["step", "ai", "search", "job"];
const JOB_STATUSES = ["new", "saved", "applied", "hidden"];

const aiKeySchema = new Schema(
  {
    ciphertext: String,
    last4: String,
    verified_at: Date,
    error: String,
  },
  { _id: false }
);

const userSchema = new Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    email_verified: { type: Boolean, default: false },
    name: { type: String, default: "", trim: true },
    password_hash: String,
    google_sub: { type: String, index: { unique: true, sparse: true } },
    avatar_url: String,
    role: { type: String, enum: ["user", "admin"], default: "user" },
    status: { type: String, enum: ["active", "disabled"], default: "active", index: true },
    session_version: { type: Number, default: 0 },
    must_change_password: { type: Boolean, default: false },
    last_login_at: Date,
    ai: {
      provider: { type: String, enum: [...AI_PROVIDERS, ""], default: "" },
      keys: {
        cursor: { type: aiKeySchema, default: undefined },
        openai: { type: aiKeySchema, default: undefined },
      },
      models: {
        cursor: { type: String, default: "composer-2.5" },
        openai: { type: String, default: "gpt-4o-mini" },
      },
    },
    crawler: {
      hourly_enabled: { type: Boolean, default: false },
      web_search: { type: Boolean, default: true },
      career_pages: { type: Boolean, default: true },
      max_job_age_days: { type: Number, default: 14 },
      searches_per_run: { type: Number, default: 3 },
      jobs_per_search: { type: Number, default: 8 },
      min_match_to_sheet: { type: Number, default: 50 },
      daily_run_limit: { type: Number, default: 24 },
      daily_token_budget: { type: Number, default: 1500000 },
      discover_companies: { type: Boolean, default: true },
      max_companies: { type: Number, default: 40 },
      career_pages_per_run: { type: Number, default: 10 },
    },
    portals: {
      crawl_enabled: { type: Boolean, default: true },
      naukri_profile_refresh: { type: Boolean, default: false },
      last_naukri_refresh_at: Date,
    },
    google: {
      refresh_token: String,
      email: String,
      scope: String,
      connected_at: Date,
    },
    drive: {
      root_folder_id: String,
      user_folder_id: String,
      resumes_folder_id: String,
      sheet_id: String,
      sheet_url: String,
      last_synced_at: Date,
      last_error: String,
    },
  },
  { timestamps: true }
);

const careerPageSchema = new Schema(
  {
    name: { type: String, default: "" },
    url: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true },
    source: { type: String, enum: ["manual", "ai"], default: "manual" },
    reason: String,
    ats: String,
    discovered_at: Date,
    last_crawled_at: Date,
    last_found: { type: Number, default: 0 },
    total_found: { type: Number, default: 0 },
    failures: { type: Number, default: 0 },
    last_error: String,
  },
  { _id: true }
);

const profileSchema = new Schema(
  {
    user_id: { type: ObjectId, ref: "User", required: true, unique: true },
    full_name: { type: String, default: "" },
    headline: { type: String, default: "" },
    email: { type: String, default: "" },
    phone: { type: String, default: "" },
    current_location: { type: String, default: "" },
    summary: { type: String, default: "" },
    experience_years: { type: Number, default: 0 },
    target_roles: { type: [String], default: [] },
    skills: { type: [String], default: [] },
    target_locations: { type: [String], default: [] },
    remote_ok: { type: Boolean, default: false },
    exclude_companies: { type: [String], default: [] },
    career_pages: { type: [careerPageSchema], default: [] },
    structured_resume: { type: Schema.Types.Mixed, default: undefined },
    suggested: { type: Schema.Types.Mixed, default: undefined },
    suggested_at: Date,
    plan_hash: String,
    plan_generated_at: Date,
    last_company_discovery_at: Date,
    edited_by_user: { type: Boolean, default: false },
  },
  { timestamps: true }
);

const resumeSchema = new Schema(
  {
    user_id: { type: ObjectId, ref: "User", required: true, index: true },
    filename: { type: String, required: true },
    mime_type: String,
    size: Number,
    data: { type: Buffer, select: false },
    text: { type: String, required: true },
    is_current: { type: Boolean, default: true, index: true },
    parse_status: { type: String, enum: ["pending", "parsing", "done", "failed"], default: "pending" },
    parse_error: String,
  },
  { timestamps: true }
);

const matchSchema = new Schema(
  {
    score: Number,
    relevancy: { type: String, enum: ["High", "Medium", "Low", ""], default: "" },
    summary: String,
    keywords: { type: [String], default: undefined },
    ats_score: Number,
    missing: { type: [String], default: undefined },
    scored_at: Date,
    error: String,
  },
  { _id: false }
);

const jobPostingSchema = new Schema(
  {
    user_id: { type: ObjectId, ref: "User", required: true },
    run_id: { type: ObjectId, ref: "Run" },
    source: { type: String, enum: JOB_SOURCES, required: true },
    source_site: String,
    job_url: { type: String, required: true },
    title: { type: String, required: true },
    company: { type: String, required: true },
    location: String,
    posted_text: String,
    age_days: Number,
    experience: String,
    description: String,
    dedupe_key: String,
    search_query: String,
    first_seen_at: { type: Date, default: Date.now },
    match: { type: matchSchema, default: () => ({}) },
    status: { type: String, enum: JOB_STATUSES, default: "new" },
    latest_resume_id: { type: ObjectId, ref: "GeneratedResume" },
  },
  { timestamps: true }
);

jobPostingSchema.index({ user_id: 1, job_url: 1 }, { unique: true });
jobPostingSchema.index({ user_id: 1, dedupe_key: 1 });
jobPostingSchema.index({ user_id: 1, first_seen_at: -1 });
jobPostingSchema.index({ user_id: 1, "match.scored_at": 1 });

const runSchema = new Schema(
  {
    user_id: { type: ObjectId, ref: "User", required: true, index: true },
    kind: { type: String, enum: RUN_KINDS, required: true },
    status: { type: String, enum: RUN_STATUSES, default: "queued", index: true },
    triggered_by: { type: String, enum: ["manual", "schedule", "system"], default: "manual" },
    stage: String,
    detail: String,
    payload: { type: Schema.Types.Mixed, default: () => ({}) },
    counters: { type: Schema.Types.Mixed, default: () => ({}) },
    result: Schema.Types.Mixed,
    error: String,
    cancel_requested: { type: Boolean, default: false },
    started_at: Date,
    finished_at: Date,
    heartbeat_at: Date,
  },
  { timestamps: true }
);

runSchema.index({ status: 1, createdAt: 1 });
runSchema.index({ user_id: 1, kind: 1, createdAt: -1 });

const runLogSchema = new Schema(
  {
    run_id: { type: ObjectId, ref: "Run", required: true, index: true },
    user_id: { type: ObjectId, ref: "User", required: true },
    kind: { type: String, enum: RUN_KINDS },
    level: { type: String, enum: ["info", "warn", "error"], default: "info" },
    tag: { type: String, enum: LOG_TAGS, default: "step" },
    message: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

runLogSchema.index({ created_at: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });
runLogSchema.index({ user_id: 1, _id: 1 });

const generatedResumeSchema = new Schema(
  {
    user_id: { type: ObjectId, ref: "User", required: true, index: true },
    job_id: { type: ObjectId, ref: "JobPosting", required: true, index: true },
    run_id: { type: ObjectId, ref: "Run" },
    status: { type: String, enum: ["queued", "done", "failed"], default: "queued" },
    resume_json: Schema.Types.Mixed,
    ats_before: Number,
    ats_after: Number,
    filename: String,
    pdf: { type: Buffer, select: false },
    drive_url: String,
    error: String,
  },
  { timestamps: true }
);

const portalConnectionSchema = new Schema(
  {
    user_id: { type: ObjectId, ref: "User", required: true },
    portal: { type: String, enum: PORTALS, required: true },
    status: { type: String, enum: ["connected", "expired"], default: "connected" },
    storage_state: { type: String, select: false },
    connected_at: Date,
    last_checked_at: Date,
    last_crawl_at: Date,
    last_error: String,
  },
  { timestamps: true }
);

portalConnectionSchema.index({ user_id: 1, portal: 1 }, { unique: true });

const loginTicketSchema = new Schema(
  {
    token_hash: { type: String, required: true, unique: true },
    user_id: { type: ObjectId, ref: "User", required: true },
    portal: { type: String, enum: PORTALS, required: true },
    viewport: {
      width: Number,
      height: Number,
      mobile: Boolean,
    },
    expires_at: { type: Date, required: true },
    used_at: Date,
  },
  { versionKey: false }
);

loginTicketSchema.index({ expires_at: 1 }, { expireAfterSeconds: 600 });

const searchQuerySchema = new Schema(
  {
    user_id: { type: ObjectId, ref: "User", required: true },
    kind: { type: String, enum: ["jobs", "companies"], required: true },
    text: { type: String, required: true, trim: true },
    key: { type: String, required: true },
    why: String,
    origin: { type: String, enum: ["plan", "user", "mint"], default: "plan" },
    uses: { type: Number, default: 0 },
    results: { type: Number, default: 0 },
    new_jobs: { type: Number, default: 0 },
    good_matches: { type: Number, default: 0 },
    last_used_at: Date,
    retired: { type: Boolean, default: false },
  },
  { timestamps: true }
);

searchQuerySchema.index({ user_id: 1, kind: 1, key: 1 }, { unique: true });

const visitedPageSchema = new Schema(
  {
    user_id: { type: ObjectId, ref: "User", required: true },
    url: { type: String, required: true },
    domain: String,
    kind: { type: String, enum: ["careers", "job", "search", "api"], default: "job" },
    visits: { type: Number, default: 1 },
    first_at: { type: Date, default: Date.now },
    last_at: { type: Date, default: Date.now },
    last_status: { type: String, enum: ["ok", "error", "not_found", "blocked"], default: "ok" },
    jobs_found: { type: Number, default: 0 },
    note: String,
  },
  { versionKey: false }
);

visitedPageSchema.index({ user_id: 1, url: 1 }, { unique: true });
visitedPageSchema.index({ user_id: 1, last_at: -1 });
visitedPageSchema.index({ last_at: 1 }, { expireAfterSeconds: 90 * 24 * 3600 });

const aiUsageSchema = new Schema(
  {
    user_id: { type: ObjectId, ref: "User", required: true },
    run_id: { type: ObjectId, ref: "Run" },
    provider: String,
    model: String,
    purpose: String,
    input_tokens: { type: Number, default: 0 },
    output_tokens: { type: Number, default: 0 },
    cache_read_tokens: { type: Number, default: 0 },
    cache_write_tokens: { type: Number, default: 0 },
    total_tokens: { type: Number, default: 0 },
    duration_ms: Number,
    est_cost_usd: Number,
    included_in_plan: Boolean,
    created_at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

aiUsageSchema.index({ user_id: 1, created_at: -1 });
aiUsageSchema.index({ created_at: 1 }, { expireAfterSeconds: 180 * 24 * 3600 });

const APPLICATION_STATUSES = [
  "queued",
  "classifying",
  "authenticating",
  "mapping_fields",
  "executing",
  "applied",
  "needs_help",
  "failed",
  "skipped_cap",
];
const APPLY_PORTAL_KINDS = ["naukri_easy", "linkedin_easy", "greenhouse", "lever", "ashby", "workday", "smartrecruiters", "unknown"];

const applyVaultSchema = new Schema(
  {
    user_id: { type: ObjectId, ref: "User", required: true, unique: true },
    full_name: { type: String, default: "" },
    email: { type: String, default: "", lowercase: true, trim: true },
    phone: { type: String, default: "" },
    current_location: { type: String, default: "" },
    linkedin_url: { type: String, default: "" },
    naukri_url: { type: String, default: "" },
    experience_years: { type: Number, default: 0 },
    notice_period: { type: String, default: "" },
    current_ctc: { type: String, default: "" },
    expected_ctc: { type: String, default: "" },
    work_authorization: { type: String, default: "" },
    education_summary: { type: String, default: "" },
    default_password_enc: { type: String, select: false },
    password_set: { type: Boolean, default: false },
    match_threshold: { type: Number, default: 70, min: 0, max: 100 },
    auto_apply_enabled: { type: Boolean, default: false },
    daily_attempt_cap: { type: Number, default: 20, min: 1, max: 20 },
  },
  { timestamps: true }
);

const applicationSchema = new Schema(
  {
    user_id: { type: ObjectId, ref: "User", required: true },
    job_id: { type: ObjectId, ref: "JobPosting", required: true },
    status: { type: String, enum: APPLICATION_STATUSES, default: "queued", index: true },
    portal_kind: { type: String, enum: APPLY_PORTAL_KINDS, default: "unknown" },
    attempts: { type: Number, default: 0 },
    attempt_counted: { type: Boolean, default: false },
    last_error: { type: String, default: "" },
    help_reason: { type: String, default: "" },
    screenshot_refs: { type: [String], default: [] },
    applied_at: Date,
    run_id: { type: ObjectId, ref: "Run" },
  },
  { timestamps: true }
);
applicationSchema.index({ user_id: 1, job_id: 1 }, { unique: true });
applicationSchema.index({ user_id: 1, status: 1, updatedAt: -1 });

const User = mongoose.model("User", userSchema);
const Profile = mongoose.model("Profile", profileSchema);
const Resume = mongoose.model("Resume", resumeSchema);
const JobPosting = mongoose.model("JobPosting", jobPostingSchema, "job_postings");
const Run = mongoose.model("Run", runSchema);
const RunLog = mongoose.model("RunLog", runLogSchema, "run_logs");
const GeneratedResume = mongoose.model("GeneratedResume", generatedResumeSchema, "generated_resumes");
const PortalConnection = mongoose.model("PortalConnection", portalConnectionSchema, "portal_connections");
const LoginTicket = mongoose.model("LoginTicket", loginTicketSchema, "login_tickets");

const SearchQuery = mongoose.model("SearchQuery", searchQuerySchema, "search_queries");
const VisitedPage = mongoose.model("VisitedPage", visitedPageSchema, "visited_pages");
const AiUsage = mongoose.model("AiUsage", aiUsageSchema, "ai_usage");
const ApplyVault = mongoose.model("ApplyVault", applyVaultSchema, "apply_vaults");
const Application = mongoose.model("Application", applicationSchema, "applications");

const ALL_MODELS = [
  User,
  Profile,
  Resume,
  JobPosting,
  Run,
  RunLog,
  GeneratedResume,
  PortalConnection,
  LoginTicket,
  SearchQuery,
  VisitedPage,
  AiUsage,
  ApplyVault,
  Application,
];

async function connectDb(uri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));
  return mongoose.connection;
}

module.exports = {
  mongoose,
  connectDb,
  AI_PROVIDERS,
  PORTALS,
  JOB_SOURCES,
  RUN_KINDS,
  LOG_TAGS,
  JOB_STATUSES,
  APPLICATION_STATUSES,
  APPLY_PORTAL_KINDS,
  PortalConnection,
  LoginTicket,
  User,
  Profile,
  Resume,
  JobPosting,
  Run,
  RunLog,
  GeneratedResume,
  SearchQuery,
  VisitedPage,
  AiUsage,
  ApplyVault,
  Application,
};
