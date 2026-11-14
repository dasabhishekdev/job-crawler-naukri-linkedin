const { auth } = require("@googleapis/drive");
const { decryptSecret } = require("@jobportal/ai");

const LOGIN_SCOPES = ["openid", "email", "profile"];
const DRIVE_SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];

function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function publicUrl() {
  return (process.env.PUBLIC_URL || "http://localhost:3006").replace(/\/+$/, "");
}

const REDIRECTS = {
  login: () => `${publicUrl()}/api/auth/google/callback`,
  drive: () => `${publicUrl()}/api/google/drive/callback`,
};

function client(purpose) {
  if (!googleConfigured()) throw new Error("Google is not configured on this server.");
  return new auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, REDIRECTS[purpose]());
}

function loginAuthUrl(state) {
  return client("login").generateAuthUrl({ scope: LOGIN_SCOPES, state, prompt: "select_account" });
}

function driveAuthUrl(state, loginHint) {
  return client("drive").generateAuthUrl({
    scope: DRIVE_SCOPES,
    state,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: true,
    login_hint: loginHint || undefined,
  });
}

async function identityFromTokens(oauth, tokens) {
  if (!tokens.id_token) return {};
  const ticket = await oauth.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
  return ticket.getPayload() || {};
}

async function exchangeLoginCode(code) {
  const oauth = client("login");
  const { tokens } = await oauth.getToken(code);
  const p = await identityFromTokens(oauth, tokens);
  if (!p.sub || !p.email) throw new Error("Google did not share an email address.");
  return { sub: p.sub, email: p.email.toLowerCase(), email_verified: Boolean(p.email_verified), name: p.name || "", picture: p.picture || "" };
}

async function exchangeDriveCode(code) {
  const oauth = client("drive");
  const { tokens } = await oauth.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google did not return offline access. Remove the app at myaccount.google.com/permissions and connect again.");
  }
  const p = await identityFromTokens(oauth, tokens);
  return { refresh_token: tokens.refresh_token, scope: tokens.scope || "", email: (p.email || "").toLowerCase() };
}

function driveAuthForUser(user) {
  if (!googleConfigured() || !user?.google?.refresh_token) return null;
  const oauth = client("drive");
  oauth.setCredentials({ refresh_token: decryptSecret(user.google.refresh_token) });
  return oauth;
}

async function revokeDrive(user) {
  if (!googleConfigured() || !user?.google?.refresh_token) return;
  await client("drive").revokeToken(decryptSecret(user.google.refresh_token)).catch(() => {});
}

module.exports = {
  googleConfigured,
  loginAuthUrl,
  driveAuthUrl,
  exchangeLoginCode,
  exchangeDriveCode,
  driveAuthForUser,
  revokeDrive,
  redirectUris: () => ({ login: REDIRECTS.login(), drive: REDIRECTS.drive() }),
};
