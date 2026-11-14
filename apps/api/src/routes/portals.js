const express = require("express");
const { z } = require("zod");
const { PORTALS, PortalConnection, Profile, Resume, enqueueRun } = require("@jobportal/db");
const { aiReady } = require("@jobportal/ai");
const { issueTicket, PORTAL_META } = require("@jobportal/portals");
const { badRequest, conflict, notFound } = require("../lib/http-error");

const portalParam = z.enum(PORTALS);
const connectSchema = z.object({
  viewport: z
    .object({
      width: z.coerce.number().min(200).max(4000),
      height: z.coerce.number().min(200).max(4000),
      mobile: z.boolean(),
    })
    .default({ width: 1280, height: 800, mobile: false }),
});
const settingsSchema = z.object({ crawl_enabled: z.boolean(), naukri_profile_refresh: z.boolean() }).partial();

function publicConnection(portal, row) {
  return {
    portal,
    label: PORTAL_META[portal].label,
    status: row?.status || "disconnected",
    connected_at: row?.connected_at || null,
    last_checked_at: row?.last_checked_at || null,
    last_crawl_at: row?.last_crawl_at || null,
    last_error: row?.last_error || "",
  };
}

function portalsRouter() {
  const router = express.Router();

  async function payload(user) {
    const rows = await PortalConnection.find({ user_id: user._id }).lean();
    return {
      portals: PORTALS.map((p) => publicConnection(p, rows.find((r) => r.portal === p))),
      settings: {
        crawl_enabled: user.portals?.crawl_enabled !== false,
        naukri_profile_refresh: Boolean(user.portals?.naukri_profile_refresh),
        last_naukri_refresh_at: user.portals?.last_naukri_refresh_at || null,
      },
    };
  }

  router.get("/", async (req, res) => {
    res.json(await payload(req.user));
  });

  router.post("/:portal/connect", async (req, res) => {
    const portal = portalParam.parse(req.params.portal);
    const { viewport } = connectSchema.parse(req.body || {});
    const ticket = await issueTicket({ userId: req.user._id, portal, viewport });
    res.status(201).json({ ticket, ws_path: "/api/portals/ws" });
  });

  router.delete("/:portal", async (req, res) => {
    const portal = portalParam.parse(req.params.portal);
    await PortalConnection.deleteOne({ user_id: req.user._id, portal });
    res.json(await payload(req.user));
  });

  router.put("/settings", async (req, res) => {
    const patch = settingsSchema.parse(req.body);
    Object.assign(req.user.portals, patch);
    await req.user.save();
    res.json(await payload(req.user));
  });

  router.post("/crawl", async (req, res) => {
    const user = req.user;
    if (!(await PortalConnection.exists({ user_id: user._id, status: "connected" }))) {
      throw badRequest("Connect LinkedIn or Naukri first.");
    }
    if (!aiReady(user)) throw badRequest("Add an AI provider key in Settings first.");
    if (!(await Resume.exists({ user_id: user._id, is_current: true }))) throw badRequest("Upload your resume first.");
    const profile = await Profile.findOne({ user_id: user._id }, "target_roles").lean();
    if (!profile?.target_roles?.length) throw badRequest("Add at least one target role to your profile first.");
    const { run, queued } = await enqueueRun({ userId: user._id, kind: "portal_crawl" });
    if (!queued) throw conflict("A portal search is already running.");
    res.status(202).json({ run_id: run._id });
  });

  router.post("/naukri/refresh", async (req, res) => {
    if (!(await PortalConnection.exists({ user_id: req.user._id, portal: "naukri", status: "connected" }))) {
      throw notFound("Connect Naukri first.");
    }
    if (!(await Resume.exists({ user_id: req.user._id, is_current: true }))) throw badRequest("Upload your resume first.");
    const { run, queued } = await enqueueRun({ userId: req.user._id, kind: "naukri_refresh" });
    if (!queued) throw conflict("A Naukri refresh is already running.");
    res.status(202).json({ run_id: run._id });
  });

  return router;
}

module.exports = { portalsRouter };
