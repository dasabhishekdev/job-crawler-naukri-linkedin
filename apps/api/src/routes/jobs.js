const express = require("express");
const { z } = require("zod");
const { JobPosting, GeneratedResume, Resume, JOB_STATUSES, enqueueRun, mongoose, Application } = require("@jobportal/db");
const { aiReady } = require("@jobportal/ai");
const { badRequest, notFound } = require("../lib/http-error");

const LIST_FIELDS = "-description -match.keywords -dedupe_key -run_id";

const listSchema = z.object({
  view: z.enum(["inbox", "saved", "applied", "hidden", "all"]).default("inbox"),
  q: z.string().trim().max(100).optional(),
  min_match: z.coerce.number().int().min(0).max(100).optional(),
  relevancy: z.enum(["High", "Medium", "Low"]).optional(),
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25),
});

const VIEW_FILTERS = {
  inbox: { status: { $in: ["new", "saved"] } },
  saved: { status: "saved" },
  applied: { status: "applied" },
  hidden: { status: "hidden" },
  all: {},
};

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function withApplyStatus(userId, jobs) {
  if (!jobs.length) return jobs;
  const apps = await Application.find({ user_id: userId, job_id: { $in: jobs.map((j) => j._id) } }, "job_id status").lean();
  const byJob = Object.fromEntries(apps.map((a) => [String(a.job_id), a.status]));
  return jobs.map((job) => ({ ...job, apply_status: byJob[String(job._id)] || null }));
}

function publicGenerated(doc) {
  return {
    id: String(doc._id),
    status: doc.status,
    ats_before: doc.ats_before,
    ats_after: doc.ats_after,
    filename: doc.filename,
    drive_url: doc.drive_url || "",
    error: doc.error || "",
    created_at: doc.createdAt,
  };
}

function jobsRouter() {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const query = listSchema.parse(req.query);
    const filter = { user_id: req.user._id, ...VIEW_FILTERS[query.view] };
    if (query.min_match) filter["match.score"] = { $gte: query.min_match };
    if (query.relevancy) filter["match.relevancy"] = query.relevancy;
    if (query.q) {
      const rx = new RegExp(escapeRegex(query.q), "i");
      filter.$or = [{ title: rx }, { company: rx }, { location: rx }];
    }
    if (query.before) filter.first_seen_at = { $lt: new Date(query.before) };

    const [jobs, counts] = await Promise.all([
      JobPosting.find(filter, LIST_FIELDS).sort({ first_seen_at: -1, _id: -1 }).limit(query.limit + 1).lean(),
      JobPosting.aggregate([
        { $match: { user_id: new mongoose.Types.ObjectId(String(req.user._id)) } },
        { $group: { _id: "$status", n: { $sum: 1 } } },
      ]),
    ]);
    const hasMore = jobs.length > query.limit;
    const page = jobs.slice(0, query.limit);
    res.json({
      jobs: await withApplyStatus(req.user._id, page),
      next_before: hasMore ? page[page.length - 1].first_seen_at : null,
      counts: Object.fromEntries(JOB_STATUSES.map((s) => [s, counts.find((c) => c._id === s)?.n || 0])),
    });
  });

  router.get("/:id", async (req, res) => {
    const job = await JobPosting.findOne({ _id: req.params.id, user_id: req.user._id }).lean();
    if (!job) throw notFound("Job not found.");
    const resumes = await GeneratedResume.find({ job_id: job._id, user_id: req.user._id }).sort("-createdAt").limit(5).lean();
    const [jobWithApply] = await withApplyStatus(req.user._id, [job]);
    res.json({ job: jobWithApply, resumes: resumes.map(publicGenerated) });
  });

  router.patch("/:id", async (req, res) => {
    const { status } = z.object({ status: z.enum(JOB_STATUSES) }).parse(req.body);
    const job = await JobPosting.findOneAndUpdate({ _id: req.params.id, user_id: req.user._id }, { $set: { status } }, { new: true, projection: LIST_FIELDS });
    if (!job) throw notFound("Job not found.");
    res.json({ job });
  });

  router.post("/:id/generate-resume", async (req, res) => {
    const job = await JobPosting.exists({ _id: req.params.id, user_id: req.user._id });
    if (!job) throw notFound("Job not found.");
    if (!aiReady(req.user)) throw badRequest("Add an AI provider key in Settings first.");
    if (!(await Resume.exists({ user_id: req.user._id, is_current: true }))) throw badRequest("Upload your resume first.");
    const { run, queued } = await enqueueRun({
      userId: req.user._id,
      kind: "generate_resume",
      payload: { job_id: String(job._id) },
    });
    res.status(queued ? 202 : 200).json({ run_id: run._id, queued });
  });

  return router;
}

function generatedRouter() {
  const router = express.Router();

  router.get("/:id/pdf", async (req, res) => {
    const doc = await GeneratedResume.findOne({ _id: req.params.id, user_id: req.user._id, status: "done" }).select("+pdf");
    if (!doc?.pdf) throw notFound("Resume not found.");
    res.set("Content-Type", "application/pdf");
    res.attachment(doc.filename || "resume.pdf");
    res.send(doc.pdf);
  });

  return router;
}

module.exports = { jobsRouter, generatedRouter, publicGenerated };
