const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough-123";
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
process.env.ADMIN_EMAILS = "admin@example.com";
process.env.PUBLIC_URL = "http://localhost:3006";

const request = require("supertest");
const { connectDb, mongoose, JobPosting, User } = require("@jobportal/db");
const { loadConfig } = require("../src/config");
const { createApp } = require("../src/app");

const MONGO = process.env.MONGODB_URI_TEST || "mongodb://localhost:27017/jobcrawler_test";
let app;

test.before(async () => {
  await connectDb(MONGO);
  await mongoose.connection.db.dropDatabase();
  await connectDb(MONGO);
  app = createApp(loadConfig());
});

test.after(async () => {
  await mongoose.connection.db.dropDatabase();
  await mongoose.disconnect();
});

async function signup(email, password = "correct-horse-battery") {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/signup").send({ name: email.split("@")[0], email, password });
  return { agent, res };
}

test("signup sets a secure session cookie and returns onboarding state", async () => {
  const { agent, res } = await signup("alice@example.com");
  assert.equal(res.status, 201);
  assert.match(res.headers["set-cookie"][0], /jc_session=.*HttpOnly.*SameSite=Lax/i);
  assert.equal(res.body.user.email, "alice@example.com");
  assert.deepEqual(
    { resume: res.body.onboarding.resume, ai: res.body.onboarding.ai, profile: res.body.onboarding.profile },
    { resume: false, ai: false, profile: false }
  );
  const me = await agent.get("/api/auth/me");
  assert.equal(me.status, 200);
  await agent.post("/api/auth/logout");
  assert.equal((await agent.get("/api/auth/me")).status, 401);
});

test("duplicate signup is rejected and login checks the password", async () => {
  assert.equal((await signup("alice@example.com")).res.status, 409);
  const bad = await request(app).post("/api/auth/login").send({ email: "alice@example.com", password: "wrong-password" });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.error, "Invalid email or password.");
  const good = await request(app).post("/api/auth/login").send({ email: "ALICE@example.com", password: "correct-horse-battery" });
  assert.equal(good.status, 200);
});

test("validation errors are readable", async () => {
  const res = await request(app).post("/api/auth/signup").send({ name: "x", email: "nope", password: "short" });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /email/i);
});

test("users only ever see their own jobs", async () => {
  const a = await signup("owner@example.com");
  const b = await signup("intruder@example.com");
  const owner = await User.findOne({ email: "owner@example.com" });
  const job = await JobPosting.create({
    user_id: owner._id,
    source: "web",
    job_url: "https://example.com/job/1",
    title: "Procurement Analyst",
    company: "Acme",
    match: { score: 80 },
  });
  const mine = await a.agent.get("/api/jobs");
  assert.equal(mine.body.jobs.length, 1);
  assert.equal(mine.body.counts.new, 1);
  const theirs = await b.agent.get("/api/jobs");
  assert.equal(theirs.body.jobs.length, 0);
  assert.equal((await b.agent.get(`/api/jobs/${job._id}`)).status, 404);
  assert.equal((await b.agent.patch(`/api/jobs/${job._id}`).send({ status: "hidden" })).status, 404);
  const saved = await a.agent.patch(`/api/jobs/${job._id}`).send({ status: "saved" });
  assert.equal(saved.body.job.status, "saved");
});

test("cross-site state-changing requests are blocked", async () => {
  const { agent } = await signup("csrf@example.com");
  const res = await agent.put("/api/profile").set("Origin", "https://evil.example").send({ headline: "x" });
  assert.equal(res.status, 403);
  const ok = await agent.put("/api/profile").set("Origin", "http://localhost:3006").send({ headline: "Ops", target_roles: ["Buyer", "buyer", "Planner"] });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.body.profile.target_roles, ["buyer", "Planner"]);
});

test("admin routes require the admin role; reset password forces a change", async () => {
  const user = await signup("member@example.com");
  assert.equal((await user.agent.get("/api/admin/users")).status, 403);

  const admin = await signup("admin@example.com");
  assert.equal(admin.res.body.user.role, "admin");
  const list = await admin.agent.get("/api/admin/users");
  const member = list.body.users.find((u) => u.email === "member@example.com");
  const reset = await admin.agent.post(`/api/admin/users/${member.id}/reset-password`);
  assert.equal(reset.status, 200);

  assert.equal((await user.agent.get("/api/auth/me")).status, 401, "old sessions are revoked");
  const login = await request(app).post("/api/auth/login").send({ email: "member@example.com", password: reset.body.temporary_password });
  assert.equal(login.body.user.must_change_password, true);

  const disabled = await admin.agent.patch(`/api/admin/users/${member.id}`).send({ status: "disabled" });
  assert.equal(disabled.status, 200);
  const blocked = await request(app).post("/api/auth/login").send({ email: "member@example.com", password: reset.body.temporary_password });
  assert.equal(blocked.status, 403);
});

test("resume upload only accepts real PDF or DOCX files", async () => {
  const { agent } = await signup("upload@example.com");
  const txt = await agent.post("/api/resume").attach("file", Buffer.from("hello"), "resume.txt");
  assert.equal(txt.status, 400);
  const fake = await agent.post("/api/resume").attach("file", Buffer.from("not really a pdf"), "resume.pdf");
  assert.equal(fake.status, 400);
  assert.match(fake.body.error, /not a valid PDF/);
});

test("portal connect issues a single-use, short-lived ticket bound to the user", async () => {
  const { consumeTicket } = require("@jobportal/portals");
  const { agent } = await signup("portal@example.com");
  const status = await agent.get("/api/portals");
  assert.deepEqual(status.body.portals.map((p) => [p.portal, p.status]), [["linkedin", "disconnected"], ["naukri", "disconnected"]]);
  assert.equal((await agent.post("/api/portals/monster/connect").send({})).status, 400);

  const res = await agent.post("/api/portals/linkedin/connect").send({ viewport: { width: 390, height: 780, mobile: true } });
  assert.equal(res.status, 201);
  assert.ok(res.body.ticket.length >= 40);
  const ticket = await consumeTicket(res.body.ticket);
  assert.equal(ticket.portal, "linkedin");
  assert.equal(String(ticket.user_id), String((await User.findOne({ email: "portal@example.com" }))._id));
  assert.equal(await consumeTicket(res.body.ticket), null, "tickets cannot be reused");
  assert.equal(await consumeTicket("forged-ticket"), null);

  const crawl = await agent.post("/api/portals/crawl");
  assert.equal(crawl.status, 400);
  assert.match(crawl.body.error, /Connect LinkedIn or Naukri/);
  const settings = await agent.put("/api/portals/settings").send({ naukri_profile_refresh: true });
  assert.equal(settings.body.settings.naukri_profile_refresh, true);
  assert.equal((await request(app).post("/api/portals/linkedin/connect").send({})).status, 401);
});

test("live log stream sends the user's own backlog and new lines as Server-Sent Events", async () => {
  const http = require("node:http");
  const { RunLog, Run } = require("@jobportal/db");
  const me = await signup("live@example.com");
  await signup("live-other@example.com");
  const meUser = await User.findOne({ email: "live@example.com" });
  const otherUser = await User.findOne({ email: "live-other@example.com" });
  const run = await Run.create({ user_id: meUser._id, kind: "crawl", status: "running" });
  await RunLog.create({ run_id: run._id, user_id: meUser._id, kind: "crawl", tag: "ai", message: "Web search · started" });
  const otherRun = await Run.create({ user_id: otherUser._id, kind: "crawl", status: "running" });
  await RunLog.create({ run_id: otherRun._id, user_id: otherUser._id, kind: "crawl", message: "SECRET other user line" });

  const cookie = me.res.headers["set-cookie"][0].split(";")[0];
  const server = app.listen(0);
  const port = server.address().port;
  const body = await new Promise((resolve, reject) => {
    let data = "";
    const req = http.get({ port, path: "/api/runs/live", headers: { cookie } }, (res) => {
      assert.equal(res.statusCode, 200);
      assert.match(res.headers["content-type"], /text\/event-stream/);
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
        if (data.includes("Scored 82%")) {
          req.destroy();
          resolve(data);
        }
      });
    });
    req.on("error", (err) => (err.code === "ECONNRESET" ? resolve(data) : reject(err)));
    setTimeout(() => RunLog.create({ run_id: run._id, user_id: meUser._id, kind: "crawl", tag: "job", message: "Scored 82% · Buyer" }), 300);
    setTimeout(() => reject(new Error(`timed out; got: ${data}`)), 6000);
  });
  server.close();
  assert.match(body, /event: logs/);
  assert.match(body, /Web search · started/);
  assert.match(body, /event: runs/);
  assert.match(body, /Scored 82% · Buyer/);
  assert.doesNotMatch(body, /SECRET other user line/);
  assert.equal((await request(app).get("/api/runs/live")).status, 401);
});

test("analysed profile suggestions can be reviewed, partly applied and dismissed", async () => {
  const { Profile } = require("@jobportal/db");
  const { agent } = await signup("suggest@example.com");
  await agent.put("/api/profile").send({ headline: "Analyst", skills: ["Excel", "SQL"], target_roles: ["Buyer"] });
  const user = await User.findOne({ email: "suggest@example.com" });
  await Profile.updateOne(
    { user_id: user._id },
    {
      $set: {
        suggested: { headline: "Procurement Operations", skills: ["excel", "GRN Follow-up"], target_roles: ["Procurement Analyst"], summary: "" },
        suggested_at: new Date(),
      },
    }
  );

  const view = await agent.get("/api/profile");
  assert.deepEqual(view.body.suggestion.changes.map((c) => c.field).sort(), ["headline", "skills", "target_roles"]);
  assert.equal(view.body.profile.suggested, undefined, "raw suggestion is not exposed");

  assert.equal((await agent.post("/api/profile/suggestion/apply").send({ fields: {} })).status, 400);
  assert.equal((await agent.post("/api/profile/suggestion/apply").send({ fields: { password_hash: "replace" } })).status, 400);

  const applied = await agent.post("/api/profile/suggestion/apply").send({ fields: { skills: "add", headline: "replace" } });
  assert.equal(applied.status, 200);
  assert.deepEqual(applied.body.profile.skills, ["Excel", "SQL", "GRN Follow-up"]);
  assert.equal(applied.body.profile.headline, "Procurement Operations");
  assert.deepEqual(applied.body.suggestion.changes.map((c) => c.field), ["target_roles"], "only unapplied changes remain");

  const dismissed = await agent.delete("/api/profile/suggestion");
  assert.equal(dismissed.body.suggestion, null);
  assert.deepEqual(dismissed.body.profile.target_roles, ["Buyer"]);
  assert.equal((await agent.post("/api/profile/suggestion/apply").send({ fields: { skills: "add" } })).status, 404);
});

test("AI key and crawl endpoints validate input and prerequisites", async () => {
  const { agent } = await signup("ai@example.com");
  assert.equal((await agent.put("/api/settings/ai-key").send({ provider: "cursor", api_key: "short" })).status, 400);
  assert.equal((await agent.put("/api/settings/ai-key").send({ provider: "other", api_key: "x".repeat(20) })).status, 400);
  const crawl = await agent.post("/api/runs/crawl");
  assert.equal(crawl.status, 400);
  assert.match(crawl.body.error, /AI provider key/);
  const settings = await agent.get("/api/settings");
  assert.equal(settings.body.ai.keys.cursor.configured, false);
  assert.equal(JSON.stringify(settings.body).includes("ciphertext"), false);
});
