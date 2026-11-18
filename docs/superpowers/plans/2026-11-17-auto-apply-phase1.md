# Auto-apply Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opt-in auto-apply for Naukri and LinkedIn Easy Apply jobs that score ≥ the user’s threshold, with a credential vault, 20 attempts/day IST cap, Application status tracking, and a Needs Help queue.

**Architecture:** Extend job-crawler with `ApplyVault` + `Application` models, enqueue applications after scoring, and a new `auto_apply` worker run that opens portal sessions (existing `portal_connections`) and runs deterministic Easy Apply adapters. Generic company-portal agents are **out of scope** (Phase 2 plan).

**Tech Stack:** Node ≥ 22.13, CommonJS (API/worker/packages), Mongoose, Playwright, Express, React/Vite SPA, `node --test`. Spec: `docs/superpowers/specs/2026-11-17-auto-apply-agents-design.md`.

## Global Constraints

- CommonJS everywhere except `apps/web` (ESM).
- Secrets encrypted with `encryptSecret` / `decryptSecret` from `@jobportal/ai` (`APP_ENCRYPTION_KEY`); never log passwords or storage states.
- Auto-apply default **off** until vault is ready and user enables it.
- Daily cap default **20** apply attempts (Easy Apply / submit click) per user per IST day (`startOfDayIst`).
- Match threshold default **70**; only `source: "naukri" | "linkedin"` jobs in Phase 1.
- One running `auto_apply` run per user (existing claimNext busy-key behavior).
- `needs_help` = manual retry only; no auto-requeue.
- Do not implement Phase 2 Auth/Form/Executor agents or playbooks in this plan.

## File map

| Path | Responsibility |
|---|---|
| `packages/db/src/models.js` | `ApplyVault`, `Application`, `RUN_KINDS` += `auto_apply`, exports |
| `packages/db/src/queue.js` | `DAILY_LIMITS.auto_apply` (run enqueue limit, separate from attempt cap) |
| `packages/core/src/apply-vault.js` | `isVaultReady`, `vaultMissingFields` |
| `packages/core/src/apply-eligibility.js` | `isApplyEligible`, portal kind from job |
| `packages/core/src/apply-cap.js` | `countAttemptsToday`, `remainingAttempts` |
| `apps/worker/src/apply/enqueue.js` | Create `Application` rows after score |
| `apps/worker/src/apply/orchestrator.js` | Drain queue inside `auto_apply` run |
| `apps/worker/src/apply/naukri-easy.js` | Naukri Easy Apply Playwright adapter |
| `apps/worker/src/apply/linkedin-easy.js` | LinkedIn Easy Apply Playwright adapter |
| `apps/worker/src/tasks/auto-apply.js` | Worker task entry |
| `apps/api/src/routes/apply.js` | Vault + applications API |
| `apps/web/src/settings/AutoApplySettings.jsx` | Settings card |
| `apps/web/src/pages/NeedsHelp.jsx` | Needs help queue UI |

---

### Task 1: DB models — ApplyVault, Application, auto_apply run kind

**Files:**
- Modify: `packages/db/src/models.js`
- Modify: `packages/db/src/queue.js`
- Test: `packages/db` has no unit test harness for schemas; cover via API/worker tests in later tasks. For this task add a small loader check under `apps/worker/test/apply-models.test.js` that imports models and asserts enums.

**Interfaces:**
- Produces: `ApplyVault`, `Application`, `APPLICATION_STATUSES`, `APPLY_PORTAL_KINDS`; `RUN_KINDS` includes `"auto_apply"`; `DAILY_LIMITS.auto_apply = 48` (scheduler/run enqueue ceiling — **not** the 20 attempt cap).

- [ ] **Step 1: Write the failing enum test**

Create `apps/worker/test/apply-models.test.js`:

```js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { RUN_KINDS, APPLICATION_STATUSES, APPLY_PORTAL_KINDS } = require("@jobportal/db");

describe("auto-apply models", () => {
  it("includes auto_apply run kind", () => {
    assert.ok(RUN_KINDS.includes("auto_apply"));
  });
  it("exports application statuses", () => {
    for (const s of ["queued", "classifying", "authenticating", "mapping_fields", "executing", "applied", "needs_help", "failed", "skipped_cap"]) {
      assert.ok(APPLICATION_STATUSES.includes(s), s);
    }
  });
  it("exports phase-1 portal kinds", () => {
    assert.ok(APPLY_PORTAL_KINDS.includes("naukri_easy"));
    assert.ok(APPLY_PORTAL_KINDS.includes("linkedin_easy"));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -w @jobportal/worker -- --test-name-pattern="auto-apply models"`

Expected: FAIL — `APPLICATION_STATUSES` / `auto_apply` missing.

- [ ] **Step 3: Implement models**

In `packages/db/src/models.js`:

1. Extend `RUN_KINDS`:
```js
const RUN_KINDS = ["parse_resume", "crawl", "generate_resume", "portal_crawl", "naukri_refresh", "auto_apply"];
```

2. Add constants and schemas (before `ALL_MODELS`):
```js
const APPLICATION_STATUSES = [
  "queued",
  "classifying",
  "authenticating",
  "mapping_fields",
  "executing",
  "applied",
  "needs_help",
  "failed",
  "skipped_cap",
];
const APPLY_PORTAL_KINDS = ["naukri_easy", "linkedin_easy", "greenhouse", "lever", "ashby", "workday", "smartrecruiters", "unknown"];

const applyVaultSchema = new Schema(
  {
    user_id: { type: ObjectId, ref: "User", required: true, unique: true },
    full_name: { type: String, default: "" },
    email: { type: String, default: "", lowercase: true, trim: true },
    phone: { type: String, default: "" },
    current_location: { type: String, default: "" },
    linkedin_url: { type: String, default: "" },
    naukri_url: { type: String, default: "" },
    experience_years: { type: Number, default: 0 },
    notice_period: { type: String, default: "" },
    current_ctc: { type: String, default: "" },
    expected_ctc: { type: String, default: "" },
    work_authorization: { type: String, default: "" },
    education_summary: { type: String, default: "" },
    default_password_enc: { type: String, select: false },
    password_set: { type: Boolean, default: false },
    match_threshold: { type: Number, default: 70, min: 0, max: 100 },
    auto_apply_enabled: { type: Boolean, default: false },
    daily_attempt_cap: { type: Number, default: 20, min: 1, max: 20 },
  },
  { timestamps: true }
);

const applicationSchema = new Schema(
  {
    user_id: { type: ObjectId, ref: "User", required: true },
    job_id: { type: ObjectId, ref: "JobPosting", required: true },
    status: { type: String, enum: APPLICATION_STATUSES, default: "queued", index: true },
    portal_kind: { type: String, enum: APPLY_PORTAL_KINDS, default: "unknown" },
    attempts: { type: Number, default: 0 },
    attempt_counted: { type: Boolean, default: false },
    last_error: { type: String, default: "" },
    help_reason: { type: String, default: "" },
    screenshot_refs: { type: [String], default: [] },
    applied_at: Date,
    run_id: { type: ObjectId, ref: "Run" },
  },
  { timestamps: true }
);
applicationSchema.index({ user_id: 1, job_id: 1 }, { unique: true });
applicationSchema.index({ user_id: 1, status: 1, updatedAt: -1 });
```

3. Register models, add to `ALL_MODELS`, export `ApplyVault`, `Application`, `APPLICATION_STATUSES`, `APPLY_PORTAL_KINDS`.

4. In `packages/db/src/queue.js` add `auto_apply: 48` to `DAILY_LIMITS`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -w @jobportal/worker -- --test-name-pattern="auto-apply models"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/models.js packages/db/src/queue.js apps/worker/test/apply-models.test.js
git commit -m "$(cat <<'EOF'
feat(db): add ApplyVault, Application, and auto_apply run kind

EOF
)"
```

---

### Task 2: Pure helpers — vault ready, eligibility, daily attempt cap

**Files:**
- Create: `packages/core/src/apply-vault.js`
- Create: `packages/core/src/apply-eligibility.js`
- Create: `packages/core/src/apply-cap.js`
- Modify: `packages/core/src/index.js` (re-export)
- Test: `packages/core/test/apply-helpers.test.js`

**Interfaces:**
- Produces:
  - `vaultMissingFields(vault) → string[]`
  - `isVaultReady(vault) → boolean` (required: full_name, email, phone, password_set OR default_password_enc present for Phase 1 Easy Apply we still require password_set for future portals; for Phase 1 Naukri/LinkedIn sessions, password is optional — **require** full_name, email, phone only for Phase 1 ready; password_set required only when enabling create-account later. Spec says vault complete before enable: require `full_name`, `email`, `phone`, and for Phase 1 also require at least one of LinkedIn/Naukri connection is checked at run time, not in vault.)
  - `portalKindForJob(job) → 'naukri_easy'|'linkedin_easy'|null` — `null` if not Phase 1 eligible source
  - `isApplyEligible({ job, vault }) → boolean` — score ≥ threshold, source naukri/linkedin, status not hidden
  - `countAttemptsToday(applicationsLean, now)` / used with Mongo in orchestrator — pure: filter `attempt_counted` and `updatedAt >= startOfDayIst`

Actually keep cap counting in worker with Mongo; pure helper:

```js
function attemptsRemaining(cap, countedToday) {
  return Math.max(0, Number(cap || 20) - Number(countedToday || 0));
}
```

- [ ] **Step 1: Write failing tests** in `packages/core/test/apply-helpers.test.js`:

```js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { vaultMissingFields, isVaultReady } = require("../src/apply-vault");
const { portalKindForJob, isApplyEligible } = require("../src/apply-eligibility");
const { attemptsRemaining } = require("../src/apply-cap");

describe("apply vault", () => {
  it("lists missing required fields", () => {
    assert.deepEqual(vaultMissingFields({}), ["full_name", "email", "phone"]);
    assert.equal(isVaultReady({ full_name: "A", email: "a@b.com", phone: "1" }), true);
  });
});

describe("apply eligibility", () => {
  it("maps naukri/linkedin sources only", () => {
    assert.equal(portalKindForJob({ source: "naukri" }), "naukri_easy");
    assert.equal(portalKindForJob({ source: "linkedin" }), "linkedin_easy");
    assert.equal(portalKindForJob({ source: "web" }), null);
  });
  it("requires score >= threshold and not hidden", () => {
    const vault = { match_threshold: 70 };
    assert.equal(isApplyEligible({ job: { source: "naukri", status: "new", match: { score: 71 } }, vault }), true);
    assert.equal(isApplyEligible({ job: { source: "naukri", status: "new", match: { score: 69 } }, vault }), false);
    assert.equal(isApplyEligible({ job: { source: "naukri", status: "hidden", match: { score: 90 } }, vault }), false);
  });
});

describe("apply cap", () => {
  it("computes remaining attempts", () => {
    assert.equal(attemptsRemaining(20, 5), 15);
    assert.equal(attemptsRemaining(20, 20), 0);
    assert.equal(attemptsRemaining(20, 25), 0);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -w @jobportal/core -- --test-name-pattern="apply"`

- [ ] **Step 3: Implement helpers** and export from `packages/core/src/index.js`.

`apply-vault.js`:
```js
const REQUIRED = ["full_name", "email", "phone"];

function vaultMissingFields(vault = {}) {
  return REQUIRED.filter((k) => !String(vault[k] || "").trim());
}

function isVaultReady(vault) {
  return vaultMissingFields(vault).length === 0;
}

module.exports = { vaultMissingFields, isVaultReady, REQUIRED_VAULT_FIELDS: REQUIRED };
```

`apply-eligibility.js`:
```js
function portalKindForJob(job) {
  if (job?.source === "naukri") return "naukri_easy";
  if (job?.source === "linkedin") return "linkedin_easy";
  return null;
}

function isApplyEligible({ job, vault }) {
  const kind = portalKindForJob(job);
  if (!kind) return false;
  if (job.status === "hidden") return false;
  const threshold = Number(vault?.match_threshold ?? 70);
  const score = Number(job?.match?.score);
  if (!Number.isFinite(score) || score < threshold) return false;
  return true;
}

module.exports = { portalKindForJob, isApplyEligible };
```

`apply-cap.js`:
```js
function attemptsRemaining(cap, countedToday) {
  return Math.max(0, Number(cap || 20) - Number(countedToday || 0));
}

module.exports = { attemptsRemaining };
```

- [ ] **Step 4: Run tests — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/apply-vault.js packages/core/src/apply-eligibility.js packages/core/src/apply-cap.js packages/core/src/index.js packages/core/test/apply-helpers.test.js
git commit -m "$(cat <<'EOF'
feat(core): add auto-apply vault, eligibility, and cap helpers

EOF
)"
```

---

### Task 3: Enqueue applications after scoring

**Files:**
- Create: `apps/worker/src/apply/enqueue.js`
- Modify: `apps/worker/src/crawl/score.js` (call enqueue after successful saves) **or** call from `ingestJobs` / end of crawl + portal_crawl — prefer a single hook after `scoreJobs` returns in `apps/worker/src/tasks/shared` consumers. Simplest: export `enqueueEligibleApplications` and call it at the end of `scoreJobs` when any jobs scored.
- Test: `apps/worker/test/apply-enqueue.test.js` (mock Application.create / findOne with mongodb if integration style matches other worker tests — use unit test of pure filter + stub). Prefer testing the filter logic by exporting `jobsToEnqueue(jobs, vault)` from enqueue.js.

**Interfaces:**
- Produces: `async function enqueueEligibleApplications({ userId, jobs, vault })` — for each eligible job without existing Application, `Application.updateOne(..., { upsert: true })` with `$setOnInsert: { status: 'queued', portal_kind }`.
- Produces: `function jobsToEnqueue(jobs, vault)` for tests.

- [ ] **Step 1: Failing test** for `jobsToEnqueue`:

```js
const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { jobsToEnqueue } = require("../src/apply/enqueue");

describe("jobsToEnqueue", () => {
  it("keeps only eligible naukri/linkedin jobs", () => {
    const vault = { match_threshold: 70, auto_apply_enabled: true };
    const jobs = [
      { _id: "1", source: "naukri", status: "new", match: { score: 80 } },
      { _id: "2", source: "web", status: "new", match: { score: 90 } },
      { _id: "3", source: "linkedin", status: "new", match: { score: 60 } },
    ];
    assert.deepEqual(
      jobsToEnqueue(jobs, vault).map((j) => String(j._id)),
      ["1"]
    );
  });
  it("returns empty when auto_apply disabled", () => {
    assert.equal(jobsToEnqueue([{ _id: "1", source: "naukri", status: "new", match: { score: 90 } }], { auto_apply_enabled: false, match_threshold: 70 }).length, 0);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Implement** `apps/worker/src/apply/enqueue.js`:

```js
const { ApplyVault, Application } = require("@jobportal/db");
const { isApplyEligible, portalKindForJob } = require("@jobportal/core");

function jobsToEnqueue(jobs, vault) {
  if (!vault?.auto_apply_enabled) return [];
  return (jobs || []).filter((job) => isApplyEligible({ job, vault }));
}

async function enqueueEligibleApplications({ userId, jobs }) {
  const vault = await ApplyVault.findOne({ user_id: userId }).lean();
  if (!vault?.auto_apply_enabled) return { enqueued: 0 };
  const eligible = jobsToEnqueue(jobs, vault);
  let enqueued = 0;
  for (const job of eligible) {
    const portal_kind = portalKindForJob(job);
    const res = await Application.updateOne(
      { user_id: userId, job_id: job._id },
      { $setOnInsert: { status: "queued", portal_kind, attempts: 0 } },
      { upsert: true }
    );
    if (res.upsertedCount) enqueued++;
  }
  return { enqueued };
}

module.exports = { jobsToEnqueue, enqueueEligibleApplications };
```

At end of `scoreJobs` in `score.js`, after the mapLimit loop:

```js
const { enqueueEligibleApplications } = require("../apply/enqueue");
// ...
if (jobs.length) {
  try {
    const { enqueued } = await enqueueEligibleApplications({ userId: jobs[0].user_id, jobs });
    if (enqueued && log) await log.info(`Auto-apply queued ${enqueued} job(s)`);
  } catch (err) {
    if (log) await log.warn(`Auto-apply enqueue: ${err.message}`);
  }
}
```

Note: `scoreJobs` currently has no `userId` arg — use `jobs[0].user_id` (JobPosting documents include `user_id`).

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/apply/enqueue.js apps/worker/src/crawl/score.js apps/worker/test/apply-enqueue.test.js
git commit -m "$(cat <<'EOF'
feat(worker): enqueue auto-apply applications after scoring

EOF
)"
```

---

### Task 4: API — apply vault + applications + retry

**Files:**
- Create: `apps/api/src/routes/apply.js`
- Modify: `apps/api/src/app.js` — mount `/api/apply`
- Modify: `apps/api/src/lib/serialize.js` if needed for vault public shape
- Test: extend `apps/api/test/api.test.js` with apply vault + needs_help retry cases

**Interfaces:**
- `GET /api/apply/vault` → public vault (no password; `password_set: boolean`)
- `PUT /api/apply/vault` → upsert fields; optional `default_password` → encrypt + `password_set: true`
- `GET /api/apply/applications?status=needs_help`
- `POST /api/apply/applications/:id/retry` → if `needs_help`|`failed`|`skipped_cap`, set `queued`, clear error
- `POST /api/apply/applications/:id/skip` → set `failed`, help_reason `skipped_by_user`
- `POST /api/apply/applications/:id/mark-applied` → `applied`, sync job status `applied`
- `POST /api/apply/run` → `enqueueRun({ kind: 'auto_apply' })`

Seed vault from Profile on first GET if missing (copy full_name, email, phone, location, experience_years).

- [ ] **Step 1: Write API test stubs** (follow patterns in `api.test.js` — signup, cookie, then):

```js
it("rejects enabling auto-apply when vault incomplete", async () => {
  const res = await agent.put("/api/apply/vault").send({ auto_apply_enabled: true });
  assert.equal(res.status, 400);
});

it("saves vault and lists needs_help applications", async () => {
  await agent.put("/api/apply/vault").send({
    full_name: "Anika B",
    email: "anika@example.com",
    phone: "9999999999",
    auto_apply_enabled: true,
    match_threshold: 70,
  });
  const get = await agent.get("/api/apply/vault");
  assert.equal(get.status, 200);
  assert.equal(get.body.auto_apply_enabled, true);
  assert.equal(get.body.password_set, false);
});
```

- [ ] **Step 2: Run — expect FAIL** (route missing)

- [ ] **Step 3: Implement `routes/apply.js`**

Use zod validation; `encryptSecret` from `@jobportal/ai` when `default_password` provided; never return ciphertext. On `auto_apply_enabled: true`, require `isVaultReady`. Mount in `app.js`:

```js
const { applyRouter } = require("./routes/apply");
app.use("/api/apply", requireUser, applyRouter());
```

- [ ] **Step 4: Run API tests — PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/routes/apply.js apps/api/src/app.js apps/api/test/api.test.js
git commit -m "$(cat <<'EOF'
feat(api): add auto-apply vault and applications endpoints

EOF
)"
```

---

### Task 5: Naukri Easy Apply adapter

**Files:**
- Create: `apps/worker/src/apply/naukri-easy.js`
- Create: `apps/worker/src/apply/detect.js` — shared success/help heuristics from page text
- Test: `apps/worker/test/naukri-easy.test.js` — unit-test pure detectors with fixture HTML/text strings (no live browser in CI)

**Interfaces:**
- Produces: `async function applyNaukriEasy({ page, jobUrl, log }) → { ok: true } | { ok: false, needsHelp: true, reason } | { ok: false, failed: true, reason }`
- Produces: `detectApplyOutcome(bodyText, url) → 'applied'|'needs_help'|'unknown'`

Detection rules (text, case-insensitive):
- applied: `/application sent|applied successfully|you have already applied|already applied/i`
- needs_help: `/captcha|otp|enter (the )?otp|verify mobile|unusual activity|checkpoint/i`
- Chatbot / external apply: if after click URL leaves naukri host to company site without success → `needs_help` reason `external_apply`

Adapter steps:
1. `page.goto(jobUrl)`
2. If login wall → throw SessionExpiredError('naukri')
3. Prefer button matching Easy Apply / Apply now that is not “Apply on company site”
4. Click; wait 2–5s; if modal with chat/questions containing required free-text beyond chat skip → needs_help `complex_form`
5. For simple one-click / confirm Apply: click confirm; re-read body; return detect outcome
6. Mark attempt as counted whenever Apply was clicked

- [ ] **Step 1: Failing detector tests**

```js
const { detectApplyOutcome } = require("../src/apply/detect");
assert.equal(detectApplyOutcome("Application sent successfully", "https://www.naukri.com/x"), "applied");
assert.equal(detectApplyOutcome("Please enter OTP", "https://www.naukri.com/x"), "needs_help");
```

- [ ] **Step 2–4: Implement detect + naukri-easy; tests PASS**

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/apply/detect.js apps/worker/src/apply/naukri-easy.js apps/worker/test/naukri-easy.test.js
git commit -m "$(cat <<'EOF'
feat(worker): add Naukri Easy Apply adapter and outcome detection

EOF
)"
```

---

### Task 6: LinkedIn Easy Apply adapter

**Files:**
- Create: `apps/worker/src/apply/linkedin-easy.js`
- Test: `apps/worker/test/linkedin-easy.test.js` (detector + step-plan helpers)

**Interfaces:**
- Produces: `async function applyLinkedInEasy({ page, jobUrl, vault, resumePath, log }) → same result shape as Naukri`

Steps:
1. Goto job URL; SessionExpiredError on login wall
2. If no `Easy Apply` button (only `Apply` external) → `{ ok:false, needsHelp:true, reason:'not_easy_apply' }`
3. Click Easy Apply; loop up to 8 modal steps:
   - Upload resume if file input visible and `resumePath` set
   - Fill inputs with `input[name]` / labels mapped from vault (phone, email) when empty
   - If Next/Review/Submit enabled, click
   - If unmapped required field (aria-invalid / required empty after fill attempt) → needs_help
4. Success: `/application submitted|done|your application was sent/i` or dismissible success modal
5. CAPTCHA / checkpoint → needs_help

For Phase 1, keep field fill minimal: email, phone, city from vault only; anything else required → needs_help (no AI Form Mapper yet).

- [ ] **Step 1–4: TDD detector strings + implement adapter**

- [ ] **Step 5: Commit**

```bash
git add apps/worker/src/apply/linkedin-easy.js apps/worker/test/linkedin-easy.test.js
git commit -m "$(cat <<'EOF'
feat(worker): add LinkedIn Easy Apply adapter

EOF
)"
```

---

### Task 7: Orchestrator + auto_apply worker task

**Files:**
- Create: `apps/worker/src/apply/orchestrator.js`
- Create: `apps/worker/src/tasks/auto-apply.js`
- Modify: `apps/worker/src/runner.js` — register handler
- Modify: `apps/worker/src/scheduler.js` — cron every 30 min for enabled users with vault + connected portal
- Test: `apps/worker/test/apply-orchestrator.test.js` — unit test status transitions with mocked adapters

**Interfaces:**
- `async function processApplication({ application, user, vault, browser, log, checkCancel })`
- `async function autoApplyTask(ctx)`

Flow for each queued application (oldest first), while `attemptsRemaining > 0`:
1. Load JobPosting; if missing → failed
2. status → classifying; set portal_kind from job
3. status → authenticating; `loadConnectedStates` for matching portal; if missing/expired → needs_help `portal_disconnected`
4. Open browser context with storageState
5. status → executing; call adapter; on Apply click set `attempt_counted: true`, `attempts++`
6. On success: status applied, job.status applied, refreshConnection storageState
7. On needs_help / failed: set fields, screenshot to `DATA_DIR/apply-screenshots/{applicationId}.png` (path in screenshot_refs), continue
8. Per-job timeout 4 minutes via `Promise.race`
9. When remaining hits 0: mark other still-queued as `skipped_cap` for this user (optional batch update at end)

Write resume temp file from current Resume PDF/DOCX bytes or GeneratedResume pdf for that job if present (`select('+data')` / `+pdf`).

- [ ] **Step 1: Orchestrator unit test** with fake adapter returning needs_help then ensure status set

- [ ] **Step 2: Implement orchestrator + task + runner wire**

```js
// runner.js
const { autoApplyTask } = require("./tasks/auto-apply");
const HANDLERS = { ..., auto_apply: autoApplyTask };
```

Scheduler:
```js
schedule("15,45 * * * *", queueAutoApply);

async function queueAutoApply() {
  const vaults = await ApplyVault.find({ auto_apply_enabled: true }, "user_id").lean();
  const users = await User.find({ _id: { $in: vaults.map((v) => v.user_id) }, status: "active" });
  await queueFor(users, "auto_apply", { needsRoles: false });
}
```

- [ ] **Step 3: Tests PASS**

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/apply/orchestrator.js apps/worker/src/tasks/auto-apply.js apps/worker/src/runner.js apps/worker/src/scheduler.js apps/worker/test/apply-orchestrator.test.js
git commit -m "$(cat <<'EOF'
feat(worker): auto_apply orchestrator, task, and scheduler

EOF
)"
```

---

### Task 8: Web UI — Settings, Needs Help, Jobs badges, Activity label

**Files:**
- Create: `apps/web/src/settings/AutoApplySettings.jsx`
- Create: `apps/web/src/pages/NeedsHelp.jsx`
- Modify: `apps/web/src/pages/Settings.jsx` — render AutoApplySettings card
- Modify: `apps/web/src/api.js` — apply.* methods
- Modify: `apps/web/src/App.jsx` (or router) — route `/needs-help`
- Modify: `apps/web/src/pages/Jobs.jsx` / `JobDetail.jsx` — show apply status if API returns it
- Modify: `apps/api/src/routes/jobs.js` — join latest Application status onto job list/detail (lean field `apply_status`)
- Modify: `apps/web/src/pages/Activity.jsx` + `LiveConsole.jsx` — label `auto_apply`
- Modify: nav component to link Needs help

**UI copy:**
- Settings card title: “Auto-apply”
- Toggle + threshold slider/number + note “Max 20 attempts/day. Naukri & LinkedIn Easy Apply only in this version.”
- Account-risk note (same tone as portal settings)
- Needs Help: table/cards with Retry / Skip / Mark applied

- [ ] **Step 1: Add api client methods**

```js
getApplyVault: () => request("/apply/vault"),
saveApplyVault: (body) => request("/apply/vault", { method: "PUT", body }),
listApplications: (params) => request(`/apply/applications${qs(params)}`),
retryApplication: (id) => request(`/apply/applications/${id}/retry`, { method: "POST" }),
skipApplication: (id) => request(`/apply/applications/${id}/skip`, { method: "POST" }),
markApplicationApplied: (id) => request(`/apply/applications/${id}/mark-applied`, { method: "POST" }),
startAutoApply: () => request("/apply/run", { method: "POST" }),
```

- [ ] **Step 2: Build AutoApplySettings + NeedsHelp pages**

- [ ] **Step 3: Wire jobs apply_status + activity labels**

- [ ] **Step 4: `npm run build:web` succeeds**

- [ ] **Step 5: Commit**

```bash
git add apps/web apps/api/src/routes/jobs.js
git commit -m "$(cat <<'EOF'
feat(web): auto-apply settings, needs-help queue, and job badges

EOF
)"
```

---

### Task 9: Docs + verify

**Files:**
- Modify: `job-crawler/README.md` — Auto-apply section (opt-in, Easy Apply only, 20/day, Needs help, Phase 2 coming)
- Modify: `.env.example` only if new env vars (prefer none; use existing `APP_ENCRYPTION_KEY` and `DATA_DIR`)

- [ ] **Step 1: Update README** with Settings → Auto-apply steps and safety note

- [ ] **Step 2: Run full test suite**

Run: `npm test`

Expected: all workspaces pass

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "$(cat <<'EOF'
docs: document Phase 1 auto-apply for Naukri and LinkedIn

EOF
)"
```

---

## Spec coverage (Phase 1)

| Spec item | Task |
|---|---|
| Match ≥ threshold enqueue | 2, 3 |
| Full auto, no pre-review | 3, 7 |
| Naukri + LinkedIn Easy Apply | 5, 6 |
| Session from portal_connections | 7 |
| Stuck → needs_help, continue | 5–7 |
| 20 attempts/day IST | 2, 7 |
| Apply vault encrypted password field | 1, 4 (password stored for Phase 2; optional Phase 1) |
| Needs Help UI + retry | 4, 8 |
| Activity logging | 7, 8 |
| Generic portal agents | **Deferred — Phase 2 plan** |
| Playbooks / ATS adapters | **Deferred — Phase 3 plan** |
| Create-account on company portals | **Deferred — Phase 2** |

## Out of scope reminders

- Do not build Auth/Form Mapper/Executor agents here.
- Do not auto-apply `source: web|career_page` jobs.
- Do not raise daily cap above 20.
- Do not store plaintext passwords in logs or API responses.
