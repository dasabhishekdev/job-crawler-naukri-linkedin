const test = require("node:test");
const assert = require("node:assert/strict");

process.env.SESSION_SECRET = "test-session-secret-that-is-long-enough-123";
process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
process.env.ADMIN_EMAILS = "admin@example.com";
process.env.PUBLIC_URL = "http://localhost:3006";

const jwt = require("jsonwebtoken");
const request = require("supertest");
const { connectDb, mongoose, JobPosting, User, Profile } = require("@jobportal/db");
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

/** Session without /api/auth/signup so apply tests stay under the auth rate limit. */
async function sessionAgent(email) {
  const user = await User.create({ email, name: email.split("@")[0] });
  await Profile.create({ user_id: user._id, full_name: user.name, email });
  const token = jwt.sign({ sub: String(user._id), sv: 0 }, process.env.SESSION_SECRET, { algorithm: "HS256", expiresIn: "30d" });
  const agent = request.agent(app);
  agent.set("Cookie", `jc_session=${token}`);
  return { agent, user };
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

test("agent memory and token usage are per user, with keyword controls", async () => {
  const { SearchQuery, VisitedPage, AiUsage } = require("@jobportal/db");
  const { agent } = await signup("memory@example.com");
  const other = await signup("memory-other@example.com");
  const me = await User.findOne({ email: "memory@example.com" });
  const them = await User.findOne({ email: "memory-other@example.com" });
  await SearchQuery.create({ user_id: me._id, kind: "jobs", text: "Procurement Analyst Bengaluru", key: "procurement analyst bengaluru", uses: 2, new_jobs: 5, good_matches: 2 });
  await VisitedPage.create({ user_id: me._id, url: "https://careers.acme.com/jobs/1", domain: "careers.acme.com", kind: "job", jobs_found: 1 });
  await AiUsage.create({ user_id: me._id, provider: "cursor", model: "composer-2.5", purpose: "Web search: buyer", total_tokens: 12000, est_cost_usd: 0.01, included_in_plan: true });
  await AiUsage.create({ user_id: them._id, provider: "cursor", model: "composer-2.5", purpose: "Secret", total_tokens: 999999 });

  const memory = await agent.get("/api/agent/memory");
  assert.equal(memory.body.queries[0].text, "Procurement Analyst Bengaluru");
  assert.equal(memory.body.visited[0].domain, "careers.acme.com");
  assert.equal(memory.body.totals.pages, 1);

  const added = await agent.post("/api/agent/queries").send({ text: "SAP Ariba jobs" });
  assert.equal(added.status, 201);
  assert.equal(added.body.query.origin, "user");
  const retired = await agent.patch(`/api/agent/queries/${added.body.query.id}`).send({ retired: true });
  assert.equal(retired.body.query.retired, true);
  assert.equal((await other.agent.patch(`/api/agent/queries/${added.body.query.id}`).send({ retired: false })).status, 404);

  const usage = await agent.get("/api/usage");
  assert.equal(usage.body.today.tokens, 12000);
  assert.equal(usage.body.today.budget, 1500000);
  assert.equal(usage.body.last7.length, 7);
  assert.equal(usage.body.last7[6].tokens, 12000);
  assert.equal(usage.body.by_purpose[0].purpose, "Web search");
  assert.equal(usage.body.by_model[0].included_in_plan, true);
  assert.equal(JSON.stringify(usage.body).includes("999999"), false);
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

test("rejects enabling auto-apply when vault incomplete", async () => {
  const { agent } = await sessionAgent("vault-incomplete@example.com");
  const res = await agent.put("/api/apply/vault").send({ auto_apply_enabled: true });
  assert.equal(res.status, 400);
  assert.equal((await request(app).get("/api/apply/vault")).status, 401);
});

test("saves vault and lists needs_help applications", async () => {
  const { Application, ApplyVault } = require("@jobportal/db");
  const { agent, user } = await sessionAgent("anika-apply@example.com");
  const saved = await agent.put("/api/apply/vault").send({
    full_name: "Anika B",
    email: "anika@example.com",
    phone: "9999999999",
    auto_apply_enabled: true,
    match_threshold: 70,
  });
  assert.equal(saved.status, 200);
  const get = await agent.get("/api/apply/vault");
  assert.equal(get.status, 200);
  assert.equal(get.body.auto_apply_enabled, true);
  assert.equal(get.body.password_set, false);
  assert.equal(get.body.full_name, "Anika B");

  const withPass = await agent.put("/api/apply/vault").send({ default_password: "portal-secret-pass" });
  assert.equal(withPass.status, 200);
  assert.equal(withPass.body.password_set, true);
  assert.equal(withPass.body.default_password, undefined);
  assert.equal(withPass.body.default_password_enc, undefined);
  assert.equal(JSON.stringify(withPass.body).includes("portal-secret-pass"), false);
  assert.equal(JSON.stringify(withPass.body).includes("default_password_enc"), false);

  const stored = await ApplyVault.findOne({ user_id: user._id }).select("+default_password_enc");
  assert.ok(stored.default_password_enc);
  assert.equal(stored.default_password_enc.includes("portal-secret-pass"), false);

  const job = await JobPosting.create({
    user_id: user._id,
    source: "naukri",
    job_url: "https://www.naukri.com/job/apply-1",
    title: "Buyer",
    company: "Acme",
    match: { score: 85 },
  });
  const appDoc = await Application.create({
    user_id: user._id,
    job_id: job._id,
    status: "needs_help",
    portal_kind: "naukri_easy",
    last_error: "captcha",
    help_reason: "captcha",
  });

  const list = await agent.get("/api/apply/applications?status=needs_help");
  assert.equal(list.status, 200);
  assert.equal(list.body.applications.length, 1);
  assert.equal(list.body.applications[0].status, "needs_help");
  assert.equal(list.body.applications[0].id, String(appDoc._id));
  assert.equal(list.body.applications[0].has_screenshot, false);
  assert.equal("screenshot_refs" in list.body.applications[0], false);

  const retry = await agent.post(`/api/apply/applications/${appDoc._id}/retry`);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.application.status, "queued");
  assert.equal(retry.body.application.last_error, "");

  const skip = await agent.post(`/api/apply/applications/${appDoc._id}/skip`);
  assert.equal(skip.status, 200);
  assert.equal(skip.body.application.status, "failed");
  assert.equal(skip.body.application.help_reason, "skipped_by_user");

  const marked = await agent.post(`/api/apply/applications/${appDoc._id}/mark-applied`);
  assert.equal(marked.status, 200);
  assert.equal(marked.body.application.status, "applied");
  assert.equal((await JobPosting.findById(job._id)).status, "applied");

  assert.equal((await agent.post(`/api/apply/applications/${appDoc._id}/retry`)).status, 400);

  const run = await agent.post("/api/apply/run");
  assert.equal(run.status, 202);
  assert.ok(run.body.run_id);
  assert.equal((await agent.post("/api/apply/run")).status, 409);

  const other = await sessionAgent("apply-intruder@example.com");
  assert.equal((await other.agent.post(`/api/apply/applications/${appDoc._id}/retry`)).status, 404);
  const theirs = await other.agent.get("/api/apply/applications?status=needs_help");
  assert.equal(theirs.body.applications.length, 0);
});

test("first vault GET seeds contact fields from the profile", async () => {
  const { agent } = await sessionAgent("seed-vault@example.com");
  await agent.put("/api/profile").send({
    full_name: "Seeded Name",
    phone: "8888888888",
    current_location: "Bengaluru",
    experience_years: 5,
  });
  const get = await agent.get("/api/apply/vault");
  assert.equal(get.status, 200);
  assert.equal(get.body.full_name, "Seeded Name");
  assert.equal(get.body.phone, "8888888888");
  assert.equal(get.body.current_location, "Bengaluru");
  assert.equal(get.body.experience_years, 5);
  assert.equal(get.body.auto_apply_enabled, false);
  assert.equal(get.body.password_set, false);
});

test("skip and mark-applied enforce application status guards", async () => {
  const { Application } = require("@jobportal/db");
  const { agent, user } = await sessionAgent("apply-guards@example.com");

  async function createApplication(status) {
    const job = await JobPosting.create({
      user_id: user._id,
      source: "naukri",
      job_url: `https://www.naukri.com/job/guard-${status}-${Math.random()}`,
      title: "Guard Test",
      company: "Acme",
    });
    return Application.create({
      user_id: user._id,
      job_id: job._id,
      status,
      portal_kind: "naukri_easy",
    });
  }

  for (const status of ["classifying", "authenticating", "mapping_fields", "executing"]) {
    const appDoc = await createApplication(status);
    assert.equal((await agent.post(`/api/apply/applications/${appDoc._id}/skip`)).status, 400);
    assert.equal((await agent.post(`/api/apply/applications/${appDoc._id}/mark-applied`)).status, 400);
  }

  const applied = await createApplication("applied");
  assert.equal((await agent.post(`/api/apply/applications/${applied._id}/skip`)).status, 400);
  const markAgain = await agent.post(`/api/apply/applications/${applied._id}/mark-applied`);
  assert.equal(markAgain.status, 200);
  assert.equal(markAgain.body.application.status, "applied");

  const queued = await createApplication("queued");
  const skipped = await agent.post(`/api/apply/applications/${queued._id}/skip`);
  assert.equal(skipped.status, 200);
  assert.equal(skipped.body.application.status, "failed");
  assert.equal(skipped.body.application.help_reason, "skipped_by_user");
});

test("job list and detail include apply_status", async () => {
  const { Application } = require("@jobportal/db");
  const { agent, user } = await sessionAgent("apply-status@example.com");
  const job = await JobPosting.create({
    user_id: user._id,
    source: "naukri",
    job_url: "https://www.naukri.com/job/apply-status-1",
    title: "Buyer",
    company: "Acme",
    match: { score: 88 },
  });
  const listed = await agent.get("/api/jobs");
  assert.equal(listed.status, 200);
  assert.equal(listed.body.jobs[0].apply_status, null);
  await Application.create({
    user_id: user._id,
    job_id: job._id,
    status: "needs_help",
    portal_kind: "naukri_easy",
    help_reason: "captcha",
  });
  assert.equal((await agent.get("/api/jobs")).body.jobs[0].apply_status, "needs_help");
  assert.equal((await agent.get(`/api/jobs/${job._id}`)).body.job.apply_status, "needs_help");
});

test("enables auto-apply and backfills eligible existing jobs", async () => {
  const { Application } = require("@jobportal/db");
  const { agent, user } = await sessionAgent("apply-backfill@example.com");

  const eligibleNaukri = await JobPosting.create({
    user_id: user._id,
    source: "naukri",
    job_url: "https://www.naukri.com/job/backfill-naukri",
    title: "Buyer",
    company: "Acme",
    match: { score: 88 },
  });
  const eligibleLinkedin = await JobPosting.create({
    user_id: user._id,
    source: "linkedin",
    job_url: "https://www.linkedin.com/jobs/view/backfill",
    title: "PM",
    company: "Beta",
    match: { score: 70 },
  });
  await JobPosting.create({
    user_id: user._id,
    source: "naukri",
    job_url: "https://www.naukri.com/job/backfill-hidden",
    title: "Hidden",
    company: "Acme",
    status: "hidden",
    match: { score: 95 },
  });
  await JobPosting.create({
    user_id: user._id,
    source: "web",
    job_url: "https://careers.acme.com/job/backfill-web",
    title: "Web role",
    company: "Acme",
    match: { score: 95 },
  });
  await JobPosting.create({
    user_id: user._id,
    source: "naukri",
    job_url: "https://www.naukri.com/job/backfill-low",
    title: "Low match",
    company: "Acme",
    match: { score: 40 },
  });
  const alreadyQueued = await JobPosting.create({
    user_id: user._id,
    source: "naukri",
    job_url: "https://www.naukri.com/job/backfill-existing",
    title: "Existing",
    company: "Acme",
    match: { score: 90 },
  });
  await Application.create({
    user_id: user._id,
    job_id: alreadyQueued._id,
    status: "needs_help",
    portal_kind: "naukri_easy",
    help_reason: "captcha",
  });

  const saved = await agent.put("/api/apply/vault").send({
    full_name: "Backfill User",
    email: "backfill@example.com",
    phone: "9999999999",
    auto_apply_enabled: true,
    match_threshold: 70,
  });
  assert.equal(saved.status, 200);

  const queued = await Application.find({ user_id: user._id, status: "queued" }).lean();
  const jobIds = queued.map((row) => String(row.job_id)).sort();
  assert.deepEqual(jobIds, [String(eligibleLinkedin._id), String(eligibleNaukri._id)].sort());
  assert.equal(await Application.countDocuments({ user_id: user._id, job_id: alreadyQueued._id, status: "needs_help" }), 1);

  const again = await agent.put("/api/apply/vault").send({ auto_apply_enabled: true, match_threshold: 70 });
  assert.equal(again.status, 200);
  assert.equal(await Application.countDocuments({ user_id: user._id, status: "queued" }), 2);
});

test("serves apply screenshots without exposing filesystem paths", async () => {
  const fs = require("fs/promises");
  const os = require("os");
  const path = require("path");
  const { Application } = require("@jobportal/db");
  const { agent, user } = await sessionAgent("apply-screenshot@example.com");
  const job = await JobPosting.create({
    user_id: user._id,
    source: "naukri",
    job_url: "https://www.naukri.com/job/screenshot-1",
    title: "Buyer",
    company: "Acme",
  });
  const appDoc = await Application.create({
    user_id: user._id,
    job_id: job._id,
    status: "needs_help",
    portal_kind: "naukri_easy",
    help_reason: "captcha",
  });
  const dir = path.join(os.tmpdir(), "apply-screenshots");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, `${appDoc._id}.png`);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
  await fs.writeFile(filePath, png);
  appDoc.screenshot_refs = [filePath];
  await appDoc.save();

  const list = await agent.get("/api/apply/applications?status=needs_help");
  assert.equal(list.status, 200);
  assert.equal(list.body.applications[0].has_screenshot, true);
  assert.equal("screenshot_refs" in list.body.applications[0], false);
  assert.equal(JSON.stringify(list.body).includes(filePath), false);

  const shot = await agent.get(`/api/apply/applications/${appDoc._id}/screenshot`);
  assert.equal(shot.status, 200);
  assert.match(shot.headers["content-type"], /image\/png/);
  assert.equal(Buffer.from(shot.body).length > 0, true);

  const other = await sessionAgent("apply-screenshot-intruder@example.com");
  assert.equal((await other.agent.get(`/api/apply/applications/${appDoc._id}/screenshot`)).status, 404);

  const bare = await Application.create({
    user_id: user._id,
    job_id: (
      await JobPosting.create({
        user_id: user._id,
        source: "naukri",
        job_url: "https://www.naukri.com/job/screenshot-2",
        title: "No shot",
        company: "Acme",
      })
    )._id,
    status: "failed",
    portal_kind: "naukri_easy",
  });
  assert.equal((await agent.get(`/api/apply/applications/${bare._id}/screenshot`)).status, 404);
});
