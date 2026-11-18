const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const express = require("express");
const { z } = require("zod");
const { ApplyVault, Application, Profile, JobPosting, APPLICATION_STATUSES, enqueueRun } = require("@jobportal/db");
const { encryptSecret } = require("@jobportal/ai");
const { isVaultReady, vaultMissingFields } = require("@jobportal/core");
const { badRequest, notFound, conflict } = require("../lib/http-error");
const { publicVault, publicApplication } = require("../lib/serialize");
const { backfillEligibleApplications } = require("../../../worker/src/apply/enqueue");

const text = (max) => z.string().trim().max(max);
const RETRYABLE = new Set(["needs_help", "failed", "skipped_cap"]);
const IN_FLIGHT = new Set(["classifying", "authenticating", "mapping_fields", "executing"]);
const SKIPPABLE = new Set(["needs_help", "failed", "queued", "skipped_cap"]);
const MARK_APPLICABLE = new Set([...SKIPPABLE, "applied"]);

const vaultSchema = z
  .object({
    full_name: text(120),
    email: text(200),
    phone: text(40),
    current_location: text(120),
    linkedin_url: text(500),
    naukri_url: text(500),
    experience_years: z.coerce.number().min(0).max(60),
    notice_period: text(80),
    current_ctc: text(80),
    expected_ctc: text(80),
    work_authorization: text(120),
    education_summary: text(1500),
    default_password: z.string().min(1).max(200),
    match_threshold: z.coerce.number().int().min(0).max(100),
    auto_apply_enabled: z.boolean(),
    daily_attempt_cap: z.coerce.number().int().min(1).max(20),
  })
  .partial();

const listSchema = z.object({
  status: z.enum(APPLICATION_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

async function getOrCreateVault(user) {
  const existing = await ApplyVault.findOne({ user_id: user._id });
  if (existing) return existing;
  const profile = await Profile.findOne({ user_id: user._id }).lean();
  try {
    return await ApplyVault.create({
      user_id: user._id,
      full_name: profile?.full_name || "",
      email: profile?.email || "",
      phone: profile?.phone || "",
      current_location: profile?.current_location || "",
      experience_years: profile?.experience_years || 0,
    });
  } catch (err) {
    if (err?.code === 11000) return ApplyVault.findOne({ user_id: user._id });
    throw err;
  }
}

async function loadApplication(req) {
  const row = await Application.findOne({ _id: req.params.id, user_id: req.user._id });
  if (!row) throw notFound("Application not found.");
  return row;
}

function screenshotRoot() {
  return path.resolve(process.env.DATA_DIR || os.tmpdir(), "apply-screenshots");
}

async function resolveOwnedScreenshot(refs = []) {
  const root = await fs.realpath(screenshotRoot()).catch(() => null);
  if (!root) return null;
  for (let i = refs.length - 1; i >= 0; i--) {
    const resolved = await fs.realpath(refs[i]).catch(() => null);
    if (resolved && (resolved === root || resolved.startsWith(root + path.sep))) return resolved;
  }
  return null;
}

function applyRouter() {
  const router = express.Router();

  router.get("/vault", async (req, res) => {
    res.json(publicVault(await getOrCreateVault(req.user)));
  });

  router.put("/vault", async (req, res) => {
    const { default_password, ...patch } = vaultSchema.parse(req.body);
    const vault = await getOrCreateVault(req.user);
    const enabling = patch.auto_apply_enabled === true && !vault.auto_apply_enabled;
    Object.assign(vault, patch);
    if (default_password) {
      vault.default_password_enc = encryptSecret(default_password);
      vault.password_set = true;
    }
    if (vault.auto_apply_enabled && !isVaultReady(vault)) {
      const missing = vaultMissingFields(vault).join(", ");
      throw badRequest(`Complete required vault fields first: ${missing}.`);
    }
    await vault.save();
    if (enabling) {
      await backfillEligibleApplications({ userId: req.user._id, vault: vault.toObject() }).catch(() => {});
    }
    res.json(publicVault(vault));
  });

  router.get("/applications", async (req, res) => {
    const query = listSchema.parse(req.query);
    const filter = { user_id: req.user._id };
    if (query.status) filter.status = query.status;
    const rows = await Application.find(filter)
      .populate({ path: "job_id", select: "title company job_url source status" })
      .sort({ updatedAt: -1 })
      .limit(query.limit)
      .lean();
    res.json({ applications: rows.map(publicApplication) });
  });

  router.get("/applications/:id/screenshot", async (req, res) => {
    const row = await loadApplication(req);
    const filePath = await resolveOwnedScreenshot(row.screenshot_refs);
    if (!filePath) throw notFound("Screenshot not found.");
    res.type("png");
    res.sendFile(filePath);
  });

  router.post("/applications/:id/retry", async (req, res) => {
    const row = await loadApplication(req);
    if (!RETRYABLE.has(row.status)) throw badRequest("This application cannot be retried.");
    row.status = "queued";
    row.last_error = "";
    row.help_reason = "";
    await row.save();
    res.json({ application: publicApplication(row) });
  });

  router.post("/applications/:id/skip", async (req, res) => {
    const row = await loadApplication(req);
    if (!SKIPPABLE.has(row.status)) throw badRequest("This application cannot be skipped.");
    row.status = "failed";
    row.help_reason = "skipped_by_user";
    await row.save();
    res.json({ application: publicApplication(row) });
  });

  router.post("/applications/:id/mark-applied", async (req, res) => {
    const row = await loadApplication(req);
    if (IN_FLIGHT.has(row.status)) throw badRequest("This application is still in progress.");
    if (!MARK_APPLICABLE.has(row.status)) throw badRequest("This application cannot be marked applied.");
    row.status = "applied";
    row.applied_at = row.applied_at || new Date();
    await row.save();
    await JobPosting.updateOne({ _id: row.job_id, user_id: req.user._id }, { $set: { status: "applied" } });
    res.json({ application: publicApplication(row) });
  });

  router.post("/run", async (req, res) => {
    const vault = await ApplyVault.findOne({ user_id: req.user._id });
    if (!vault?.auto_apply_enabled || !isVaultReady(vault)) {
      throw badRequest("Enable auto-apply and complete your apply vault first.");
    }
    const { run, queued } = await enqueueRun({ userId: req.user._id, kind: "auto_apply" });
    if (!queued) throw conflict("An auto-apply run is already running.");
    res.status(202).json({ run_id: run._id });
  });

  return router;
}

module.exports = { applyRouter };
