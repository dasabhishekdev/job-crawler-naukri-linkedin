const crypto = require("crypto");
const express = require("express");
const { encryptSecret } = require("@jobportal/ai");
const { googleConfigured, driveAuthUrl, exchangeDriveCode, revokeDrive, syncUserSheet } = require("@jobportal/google");
const { issueOAuthState, readOAuthState, requireUser } = require("../middleware/session");
const { badRequest } = require("../lib/http-error");
const { publicGoogle } = require("../lib/serialize");

function googleRouter(config) {
  const router = express.Router();

  router.get("/drive/connect", requireUser, (req, res) => {
    if (!googleConfigured()) throw badRequest("Google Drive is not enabled on this server.");
    const state = crypto.randomBytes(16).toString("hex");
    issueOAuthState(res, config, { state, purpose: "drive", uid: String(req.user._id) });
    res.redirect(driveAuthUrl(state, req.user.email));
  });

  router.get("/drive/callback", requireUser, async (req, res) => {
    const saved = readOAuthState(req, res, config);
    const done = (status) => res.redirect(`/settings?drive=${status}`);
    if (req.query.error) return done("cancelled");
    if (!saved || saved.purpose !== "drive" || saved.state !== req.query.state || saved.uid !== String(req.user._id)) {
      return done("expired");
    }
    try {
      const tokens = await exchangeDriveCode(String(req.query.code || ""));
      req.user.google = {
        refresh_token: encryptSecret(tokens.refresh_token),
        email: tokens.email,
        scope: tokens.scope,
        connected_at: new Date(),
      };
      await req.user.save();
    } catch (err) {
      console.warn("[google] Drive connect failed:", err.message);
      return done("failed");
    }
    try {
      await syncUserSheet(req.user);
    } catch (err) {
      console.warn("[google] First sheet sync failed:", err.message);
    }
    done("connected");
  });

  router.post("/drive/disconnect", requireUser, async (req, res) => {
    await revokeDrive(req.user);
    req.user.google = {};
    req.user.drive = {};
    await req.user.save();
    res.json({ google: publicGoogle(req.user) });
  });

  router.post("/drive/sync", requireUser, async (req, res) => {
    const result = await syncUserSheet(req.user);
    if (!result) throw badRequest("Connect Google Drive first.");
    res.json({ ...result, google: publicGoogle(req.user) });
  });

  return router;
}

module.exports = { googleRouter };
