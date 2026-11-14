const crypto = require("crypto");
const express = require("express");
const bcrypt = require("bcryptjs");
const { z } = require("zod");
const { User, Profile } = require("@jobportal/db");
const { googleConfigured, loginAuthUrl, exchangeLoginCode } = require("@jobportal/google");
const { issueSession, clearSession, issueOAuthState, readOAuthState, requireUser } = require("../middleware/session");
const { authLimiter } = require("../middleware/security");
const { badRequest, conflict, unauthorized, forbidden } = require("../lib/http-error");
const { publicUser } = require("../lib/serialize");
const { onboardingStatus } = require("../lib/onboarding");

const BCRYPT_COST = 12;
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_COST);

const email = z.string().trim().toLowerCase().email("Enter a valid email address.").max(200);
const password = z.string().min(8, "Use at least 8 characters.").max(200);
const signupSchema = z.object({ name: z.string().trim().min(1, "Enter your name.").max(120), email, password });
const loginSchema = z.object({ email, password: z.string().min(1).max(200) });
const passwordSchema = z.object({ current_password: z.string().max(200).optional(), new_password: password });

function authRouter(config) {
  const router = express.Router();

  function roleFor(userEmail) {
    return config.adminEmails.has(userEmail) ? "admin" : "user";
  }

  async function respondWithMe(res, user) {
    res.json({ user: publicUser(user), onboarding: await onboardingStatus(user) });
  }

  router.get("/config", (_req, res) => {
    res.json({ google_login: googleConfigured() });
  });

  router.post("/signup", authLimiter, async (req, res) => {
    const body = signupSchema.parse(req.body);
    if (await User.exists({ email: body.email })) throw conflict("An account with this email already exists. Sign in instead.");
    const user = await User.create({
      name: body.name,
      email: body.email,
      password_hash: await bcrypt.hash(body.password, BCRYPT_COST),
      role: roleFor(body.email),
      last_login_at: new Date(),
    });
    await Profile.create({ user_id: user._id, full_name: body.name, email: body.email });
    issueSession(res, config, user);
    res.status(201);
    await respondWithMe(res, user);
  });

  router.post("/login", authLimiter, async (req, res) => {
    const body = loginSchema.parse(req.body);
    const user = await User.findOne({ email: body.email });
    const ok = await bcrypt.compare(body.password, user?.password_hash || DUMMY_HASH);
    if (!user || !user.password_hash || !ok) {
      throw unauthorized(user && !user.password_hash ? "This account uses Google sign-in." : "Invalid email or password.");
    }
    if (user.status !== "active") throw forbidden("This account is disabled. Contact the administrator.");
    user.last_login_at = new Date();
    if (roleFor(user.email) === "admin") user.role = "admin";
    await user.save();
    issueSession(res, config, user);
    await respondWithMe(res, user);
  });

  router.post("/logout", (_req, res) => {
    clearSession(res, config);
    res.json({ ok: true });
  });

  router.post("/logout-all", requireUser, async (req, res) => {
    req.user.session_version = (req.user.session_version || 0) + 1;
    await req.user.save();
    clearSession(res, config);
    res.json({ ok: true });
  });

  router.get("/me", requireUser, async (req, res) => {
    await respondWithMe(res, req.user);
  });

  router.post("/password", requireUser, async (req, res) => {
    const body = passwordSchema.parse(req.body);
    const user = req.user;
    if (user.password_hash && !user.must_change_password) {
      if (!body.current_password || !(await bcrypt.compare(body.current_password, user.password_hash))) {
        throw badRequest("Your current password is incorrect.");
      }
    }
    user.password_hash = await bcrypt.hash(body.new_password, BCRYPT_COST);
    user.must_change_password = false;
    user.session_version = (user.session_version || 0) + 1;
    await user.save();
    issueSession(res, config, user);
    await respondWithMe(res, user);
  });

  router.get("/google/start", authLimiter, (_req, res) => {
    if (!googleConfigured()) throw badRequest("Google sign-in is not enabled on this server.");
    const state = crypto.randomBytes(16).toString("hex");
    issueOAuthState(res, config, { state, purpose: "login" });
    res.redirect(loginAuthUrl(state));
  });

  router.get("/google/callback", async (req, res) => {
    const saved = readOAuthState(req, res, config);
    const fail = (code) => res.redirect(`/login?error=${encodeURIComponent(code)}`);
    if (req.query.error) return fail("google_cancelled");
    if (!saved || saved.purpose !== "login" || saved.state !== req.query.state) return fail("google_expired");

    let identity;
    try {
      identity = await exchangeLoginCode(String(req.query.code || ""));
    } catch (err) {
      console.warn("[auth] Google login failed:", err.message);
      return fail("google_failed");
    }
    if (!identity.email_verified) return fail("google_unverified");

    let user = await User.findOne({ google_sub: identity.sub });
    if (!user) {
      user = await User.findOne({ email: identity.email });
      if (user) {
        user.google_sub = identity.sub;
        if (!user.email_verified) {
          // An unverified password account may have been created by someone else with this email.
          user.password_hash = undefined;
          user.session_version = (user.session_version || 0) + 1;
        }
      } else {
        user = new User({ email: identity.email, name: identity.name, google_sub: identity.sub, role: roleFor(identity.email) });
        await Profile.create({ user_id: user._id, full_name: identity.name, email: identity.email });
      }
    }
    if (user.status !== "active") return fail("disabled");
    user.email_verified = true;
    user.avatar_url = identity.picture || user.avatar_url;
    user.name = user.name || identity.name;
    user.last_login_at = new Date();
    if (roleFor(user.email) === "admin") user.role = "admin";
    await user.save();
    issueSession(res, config, user);
    res.redirect("/");
  });

  return router;
}

module.exports = { authRouter };
