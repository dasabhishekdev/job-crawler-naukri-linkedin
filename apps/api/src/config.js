const isProduction = process.env.NODE_ENV === "production";

function required(name, { minLength = 1 } = {}) {
  const value = process.env[name] || "";
  if (value.length < minLength) {
    throw new Error(`${name} must be set${minLength > 1 ? ` (at least ${minLength} characters)` : ""}`);
  }
  return value;
}

function loadConfig() {
  const publicUrl = (process.env.PUBLIC_URL || "http://localhost:3006").replace(/\/+$/, "");
  const extraOrigins = (process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  return {
    isProduction,
    port: Number(process.env.API_PORT) || 4000,
    mongoUri: process.env.MONGODB_URI || "mongodb://localhost:27017/jobportal",
    publicUrl,
    allowedOrigins: new Set([new URL(publicUrl).origin, ...extraOrigins]),
    sessionSecret: required("SESSION_SECRET", { minLength: 32 }),
    cookieSecure: publicUrl.startsWith("https://"),
    // Proxies in front of the API: Caddy alone = 1; edge nginx + Caddy = 2.
    trustProxyHops: Number(process.env.TRUST_PROXY_HOPS) || 1,
    adminEmails: new Set(
      (process.env.ADMIN_EMAILS || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean)
    ),
    encryptionKeySet: Boolean(required("APP_ENCRYPTION_KEY")),
  };
}

module.exports = { loadConfig };
