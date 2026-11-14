const mongoose = require("mongoose");

const { Schema } = mongoose;
const ObjectId = Schema.Types.ObjectId;

const AI_PROVIDERS = ["cursor", "openai"];
const RUN_KINDS = ["parse_resume", "crawl", "generate_resume"];
const RUN_STATUSES = ["queued", "running", "completed", "failed", "cancelled"];
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
    last_crawled_at: Date,
    last_found: { type: Number, default: 0 },
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
    source: { type: String, enum: ["web", "career_page"], required: true },
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
    level: { type: String, enum: ["info", "warn", "error"], default: "info" },
    message: { type: String, required: true },
    created_at: { type: Date, default: Date.now },
  },
  { versionKey: false }
);

runLogSchema.index({ created_at: 1 }, { expireAfterSeconds: 30 * 24 * 3600 });

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

const User = mongoose.model("User", userSchema);
const Profile = mongoose.model("Profile", profileSchema);
const Resume = mongoose.model("Resume", resumeSchema);
const JobPosting = mongoose.model("JobPosting", jobPostingSchema, "job_postings");
const Run = mongoose.model("Run", runSchema);
const RunLog = mongoose.model("RunLog", runLogSchema, "run_logs");
const GeneratedResume = mongoose.model("GeneratedResume", generatedResumeSchema, "generated_resumes");

async function connectDb(uri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 15000 });
  await Promise.all([User, Profile, Resume, JobPosting, Run, RunLog, GeneratedResume].map((m) => m.syncIndexes()));
  return mongoose.connection;
}

module.exports = {
  mongoose,
  connectDb,
  AI_PROVIDERS,
  RUN_KINDS,
  JOB_STATUSES,
  User,
  Profile,
  Resume,
  JobPosting,
  Run,
  RunLog,
  GeneratedResume,
};
