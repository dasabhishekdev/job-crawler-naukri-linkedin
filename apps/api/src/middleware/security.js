const { rateLimit } = require("express-rate-limit");
const { forbidden } = require("../lib/http-error");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Blocks cross-site state-changing requests (defence in depth on top of SameSite=Lax cookies). */
function originCheck(config) {
  return function checkOrigin(req, _res, next) {
    if (SAFE_METHODS.has(req.method)) return next();
    const origin = req.get("origin");
    if (origin && !config.allowedOrigins.has(origin)) return next(forbidden("Cross-site request blocked."));
    next();
  };
}

function limiter(windowMinutes, limit, message) {
  return rateLimit({
    windowMs: windowMinutes * 60 * 1000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: message },
  });
}

const authLimiter = limiter(15, 20, "Too many sign-in attempts. Wait a few minutes and try again.");
const apiLimiter = limiter(15, 900, "Too many requests. Slow down and try again shortly.");
const uploadLimiter = limiter(60, 20, "Too many uploads. Try again later.");

module.exports = { originCheck, authLimiter, apiLimiter, uploadLimiter };
