const jwt = require("jsonwebtoken");
const { User } = require("@jobportal/db");
const { unauthorized, forbidden } = require("../lib/http-error");

const SESSION_COOKIE = "jc_session";
const OAUTH_COOKIE = "jc_oauth";
const SESSION_DAYS = 30;

function cookieOptions(config, maxAgeMs) {
  return { httpOnly: true, secure: config.cookieSecure, sameSite: "lax", path: "/", maxAge: maxAgeMs };
}

function issueSession(res, config, user) {
  const token = jwt.sign({ sub: String(user._id), sv: user.session_version || 0 }, config.sessionSecret, {
    algorithm: "HS256",
    expiresIn: `${SESSION_DAYS}d`,
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions(config, SESSION_DAYS * 86400000));
}

function clearSession(res, config) {
  res.clearCookie(SESSION_COOKIE, cookieOptions(config, undefined));
}

/** Short-lived signed cookie carrying the OAuth `state` (and the user id for Drive connects). */
function issueOAuthState(res, config, payload) {
  const token = jwt.sign(payload, config.sessionSecret, { algorithm: "HS256", expiresIn: "10m" });
  res.cookie(OAUTH_COOKIE, token, cookieOptions(config, 10 * 60 * 1000));
}

function readOAuthState(req, res, config) {
  const token = req.cookies?.[OAUTH_COOKIE];
  res.clearCookie(OAUTH_COOKIE, cookieOptions(config, undefined));
  if (!token) return null;
  try {
    return jwt.verify(token, config.sessionSecret, { algorithms: ["HS256"] });
  } catch {
    return null;
  }
}

function sessionMiddleware(config) {
  return async function loadUser(req, _res, next) {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next();
    try {
      const claims = jwt.verify(token, config.sessionSecret, { algorithms: ["HS256"] });
      const user = await User.findById(claims.sub);
      if (user && user.status === "active" && (user.session_version || 0) === claims.sv) req.user = user;
    } catch {
      /* invalid or expired session: treat as signed out */
    }
    next();
  };
}

function requireUser(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== "admin") return next(forbidden());
  next();
}

module.exports = {
  issueSession,
  clearSession,
  issueOAuthState,
  readOAuthState,
  sessionMiddleware,
  requireUser,
  requireAdmin,
  SESSION_COOKIE,
};
