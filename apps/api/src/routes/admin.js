const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { User, JobPosting, Run } = require("@jobportal/db");
const { badRequest, notFound } = require("../lib/http-error");

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function temporaryPassword() {
  return crypto.randomBytes(9).toString("base64url");
}

function adminRouter() {
  const router = express.Router();

  router.get("/stats", async (_req, res) => {
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    const [users, activeUsers, jobs, runs] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ last_login_at: { $gte: new Date(Date.now() - 7 * 86400000) } }),
      JobPosting.estimatedDocumentCount(),
      Run.aggregate([{ $match: { createdAt: { $gte: since } } }, { $group: { _id: { kind: "$kind", status: "$status" }, n: { $sum: 1 } } }]),
    ]);
    res.json({ users, active_users_7d: activeUsers, jobs, runs_24h: runs.map((r) => ({ ...r._id, count: r.n })) });
  });

  router.get("/users", async (req, res) => {
    const { q } = z.object({ q: z.string().trim().max(100).optional() }).parse(req.query);
    const filter = q ? { $or: [{ email: new RegExp(escapeRegex(q), "i") }, { name: new RegExp(escapeRegex(q), "i") }] } : {};
    const users = await User.find(filter, "email name role status last_login_at createdAt google_sub ai.provider crawler.hourly_enabled")
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    const counts = await JobPosting.aggregate([
      { $match: { user_id: { $in: users.map((u) => u._id) } } },
      { $group: { _id: "$user_id", n: { $sum: 1 } } },
    ]);
    const byUser = new Map(counts.map((c) => [String(c._id), c.n]));
    res.json({
      users: users.map((u) => ({
        id: String(u._id),
        email: u.email,
        name: u.name,
        role: u.role,
        status: u.status,
        google: Boolean(u.google_sub),
        ai_provider: u.ai?.provider || "",
        hourly: Boolean(u.crawler?.hourly_enabled),
        jobs: byUser.get(String(u._id)) || 0,
        last_login_at: u.last_login_at,
        created_at: u.createdAt,
      })),
    });
  });

  router.patch("/users/:id", async (req, res) => {
    const patch = z.object({ status: z.enum(["active", "disabled"]), role: z.enum(["user", "admin"]) }).partial().parse(req.body);
    if (String(req.params.id) === String(req.user._id)) throw badRequest("You cannot change your own account here.");
    const user = await User.findById(req.params.id);
    if (!user) throw notFound("User not found.");
    Object.assign(user, patch);
    if (patch.status === "disabled") user.session_version = (user.session_version || 0) + 1;
    await user.save();
    res.json({ ok: true });
  });

  router.post("/users/:id/reset-password", async (req, res) => {
    const user = await User.findById(req.params.id);
    if (!user) throw notFound("User not found.");
    const password = temporaryPassword();
    user.password_hash = await bcrypt.hash(password, 12);
    user.must_change_password = true;
    user.session_version = (user.session_version || 0) + 1;
    await user.save();
    res.json({ temporary_password: password });
  });

  return router;
}

module.exports = { adminRouter };
