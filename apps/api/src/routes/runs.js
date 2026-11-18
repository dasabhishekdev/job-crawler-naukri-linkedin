const express = require("express");
const { z } = require("zod");
const { Run, RunLog, Profile, Resume, RUN_KINDS, enqueueRun } = require("@jobportal/db");
const { aiReady } = require("@jobportal/ai");
const { badRequest, notFound, conflict } = require("../lib/http-error");

const RUN_FIELDS = "kind status triggered_by stage detail counters result error payload started_at finished_at createdAt";

function runsRouter() {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const { kind, limit } = z
      .object({ kind: z.enum(RUN_KINDS).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) })
      .parse(req.query);
    const filter = { user_id: req.user._id };
    if (kind) filter.kind = kind;
    const runs = await Run.find(filter, RUN_FIELDS).sort({ createdAt: -1 }).limit(limit).lean();
    res.json({ runs });
  });

  router.get("/active", async (req, res) => {
    const runs = await Run.find({ user_id: req.user._id, status: { $in: ["queued", "running"] } }, RUN_FIELDS)
      .sort({ createdAt: -1 })
      .lean();
    res.json({ runs });
  });

  router.get("/:id", async (req, res) => {
    const run = await Run.findOne({ _id: req.params.id, user_id: req.user._id }, RUN_FIELDS).lean();
    if (!run) throw notFound("Run not found.");
    const logs = await RunLog.find({ run_id: run._id }, "kind level tag message created_at").sort({ created_at: -1 }).limit(200).lean();
    res.json({ run, logs: logs.reverse() });
  });

  router.post("/crawl", async (req, res) => {
    const user = req.user;
    if (!aiReady(user)) throw badRequest("Add an AI provider key in Settings first.");
    if (!(await Resume.exists({ user_id: user._id, is_current: true }))) throw badRequest("Upload your resume first.");
    const profile = await Profile.findOne({ user_id: user._id }, "target_roles").lean();
    if (!profile?.target_roles?.length) throw badRequest("Add at least one target role to your profile first.");
    const { run, queued } = await enqueueRun({
      userId: user._id,
      kind: "crawl",
      triggeredBy: "manual",
      dailyLimit: user.crawler?.daily_run_limit,
    });
    if (!queued) throw conflict("A job search is already running.");
    res.status(202).json({ run_id: run._id });
  });

  /** Re-open inbox/saved job URLs; hide expired or dead postings. No AI key required. */
  router.post("/check-links", async (req, res) => {
    const body = z
      .object({
        min_score: z.coerce.number().int().min(0).max(100).default(70),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.body || {});
    const { run, queued } = await enqueueRun({
      userId: req.user._id,
      kind: "check_links",
      triggeredBy: "manual",
      payload: { min_score: body.min_score, limit: body.limit },
    });
    if (!queued) throw conflict("A link check is already running.");
    res.status(202).json({ run_id: run._id });
  });

  router.post("/:id/cancel", async (req, res) => {
    const run = await Run.findOneAndUpdate(
      { _id: req.params.id, user_id: req.user._id, status: { $in: ["queued", "running"] } },
      { $set: { cancel_requested: true, status: "cancelled", finished_at: new Date() } },
      { new: true, projection: RUN_FIELDS }
    );
    if (!run) throw notFound("No active run with this id.");
    res.json({ run });
  });

  return router;
}

module.exports = { runsRouter };
