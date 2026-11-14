const crypto = require("crypto");
const { LoginTicket } = require("@jobportal/db");

const TICKET_TTL_MS = 60 * 1000;

function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("hex");
}

async function issueTicket({ userId, portal, viewport }) {
  const token = crypto.randomBytes(32).toString("base64url");
  await LoginTicket.create({
    token_hash: hashToken(token),
    user_id: userId,
    portal,
    viewport,
    expires_at: new Date(Date.now() + TICKET_TTL_MS),
  });
  return token;
}

/** Atomically marks an unexpired ticket as used and returns it (or null). */
async function consumeTicket(token) {
  if (!token || typeof token !== "string" || token.length > 100) return null;
  return LoginTicket.findOneAndUpdate(
    { token_hash: hashToken(token), used_at: null, expires_at: { $gt: new Date() } },
    { $set: { used_at: new Date() } },
    { new: true }
  ).lean();
}

module.exports = { issueTicket, consumeTicket, hashToken, TICKET_TTL_MS };
