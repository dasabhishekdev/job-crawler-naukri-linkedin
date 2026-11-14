const crypto = require("crypto");

function encryptionKey() {
  const raw = process.env.APP_ENCRYPTION_KEY || "";
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must be 32 bytes (base64 or 64 hex chars). Generate one with: openssl rand -base64 32");
  }
  return key;
}

function encryptSecret(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ct = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ct.toString("base64")].join(":");
}

function decryptSecret(payload) {
  const [version, iv, tag, ct] = String(payload || "").split(":");
  if (version !== "v1" || !iv || !tag || !ct) throw new Error("Unrecognised secret format");
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64")), decipher.final()]).toString("utf8");
}

function last4(secret) {
  return String(secret || "").slice(-4);
}

module.exports = { encryptSecret, decryptSecret, last4 };
