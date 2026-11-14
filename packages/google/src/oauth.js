const crypto = require("crypto");
const { auth } = require("@googleapis/drive");
const { AppSettings } = require("@jobportal/db");

const SETTINGS_ID = "google";
const SCOPES = ["https://www.googleapis.com/auth/drive.file", "openid", "email"];

function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function redirectUri() {
  return process.env.GOOGLE_REDIRECT_URI || "http://localhost:4000/api/google/oauth/callback";
}

function newClient() {
  if (!googleConfigured()) {
    throw new Error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in job-crawler/.env first.");
  }
  return new auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, redirectUri());
}

async function readData() {
  const doc = await AppSettings.findById(SETTINGS_ID).lean();
  return doc?.data || {};
}

async function writeData(data) {
  await AppSettings.findByIdAndUpdate(SETTINGS_ID, { $set: { data } }, { upsert: true, setDefaultsOnInsert: true });
}

async function getAuthUrl() {
  const client = newClient();
  const state = crypto.randomBytes(16).toString("hex");
  await writeData({ ...(await readData()), pending_state: state });
  return client.generateAuthUrl({ access_type: "offline", prompt: "consent", scope: SCOPES, state });
}

async function connectWithCode(code, state) {
  const data = await readData();
  if (!state || state !== data.pending_state) throw new Error("Google sign-in expired. Click Connect Google again.");
  const client = newClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh token. Remove the app at myaccount.google.com/permissions and connect again.");
  }
  let email = "";
  if (tokens.id_token) {
    const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID });
    email = ticket.getPayload()?.email || "";
  }
  await writeData({ refresh_token: tokens.refresh_token, email, scope: tokens.scope, connected_at: new Date() });
  return { email };
}

async function getAuthorizedClient() {
  if (!googleConfigured()) return null;
  const data = await readData();
  if (!data.refresh_token) return null;
  const client = newClient();
  client.setCredentials({ refresh_token: data.refresh_token });
  return client;
}

async function disconnectGoogle() {
  const data = await readData();
  if (data.refresh_token && googleConfigured()) {
    await newClient().revokeToken(data.refresh_token).catch(() => {});
  }
  await writeData({});
}

async function googleStatus() {
  const data = await readData();
  return {
    configured: googleConfigured(),
    connected: Boolean(data.refresh_token),
    email: data.email || "",
    connected_at: data.connected_at || null,
    redirect_uri: redirectUri(),
  };
}

module.exports = { getAuthUrl, connectWithCode, getAuthorizedClient, disconnectGoogle, googleStatus, googleConfigured };
