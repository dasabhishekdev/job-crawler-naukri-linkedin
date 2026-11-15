const isProduction = process.env.NODE_ENV === "production";

function required(name, { minLength = 1 } = {}) {
  const value = process.env[name] || "";
  if (value.length < minLength) {
    throw new Error(`${name} must be set${minLength > 1 ? ` (at least ${minLength} characters)` : ""}`);
  }
  return value;
}

function requireEncryptionKey() {
  const raw = required("APP_ENCRYPTION_KEY");
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must be 32 bytes (base64 or 64 hex chars). Generate one with: openssl rand -base64 32");
  }
  return true;
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
    encryptionKeySet: requireEncryptionKey(),
  };
}

module.exports = { loadConfig };
