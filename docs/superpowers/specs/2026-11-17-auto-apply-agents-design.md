# Auto-apply multi-agent system — design

Approved in brainstorming 2026-11-17. Builds on `2026-11-14-job-crawler-platform-design.md`, `2026-11-14-portal-connections-design.md`, and `2026-11-14-smart-agent-design.md`. Extends the platform beyond crawl/score into **automatic job applications**.

## Goals

1. Automatically apply to jobs that score at or above a user threshold (default **70%**), with **no pre-submit human review**.
2. Support **Naukri Easy Apply** and **LinkedIn Easy Apply** first, plus **arbitrary company portals** via a generic agent path.
3. Auth order: reuse saved session → login with vault email/password → **create account** with the same defaults if needed.
4. When stuck (CAPTCHA, OTP, unmappable required field, timeout): mark **Needs help**, skip, continue other applies; user retries later from a queue.
5. Hard cap **20 apply attempts per user per IST day**.
6. Learn **playbooks** from successful applies so known domains/ATS become cheap and deterministic.

Non-goals for v1: live human takeover browser for CAPTCHA, WhatsApp/Telegram alerts, multi-apply parallelism per user, covering every ATS with hand-written scripts before ship.

## Product decisions (locked)

| Topic | Choice |
|---|---|
| Autonomy | Full auto; human only via Needs help queue |
| Trigger | Match score ≥ threshold (default 70%) |
| Portals | Naukri + LinkedIn Easy Apply **and** unknown company portals |
| Auth | Session → login → create account with vault defaults |
| Stuck | Skip after timeout → Needs help → continue |
| Daily cap | 20 attempts/day (counts Easy Apply / submit clicks, not only confirmed success) |
| Architecture | Hybrid: playbook adapters + multi-agent fallback |

## Architecture

New worker run kind `auto_apply` on the existing job-crawler stack (API + worker + Playwright browser patterns from `apps/browser` / worker Chromium). Not a separate product.

```text
Jobs (match ≥ threshold)
        │
        ▼
┌───────────────────┐
│ Apply Orchestrator│  queue, 20/day, status machine, 1 browser/user
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│ Portal Classifier │  linkedin_easy | naukri_easy | ats_* | unknown
└─────────┬─────────┘
          │
    ┌─────┴──────┐
    ▼            ▼
 Playbook      Agent path
 adapter     Auth → Form Mapper → Executor
    │            │
    └─────┬──────┘
          ▼
   Playwright browser
          │
          ▼
   Application + Needs Help + Playbook memory
```

**Boundaries**

- **Orchestrator** — whether/when; never fills forms.
- **Classifier** — labels portal; never submits.
- **Auth / Form Mapper / Executor** — separate so failures are attributable.
- **Playbooks** — short-circuit agents when a domain/ATS recipe is known and healthy.
- **portal_connections** — LinkedIn/Naukri sessions feed Auth.
- **Apply vault** — encrypted default credentials + structured candidate facts for Form Mapper.

## Components

### Candidate Apply Vault (per user)

Structured facts Form Mapper must not invent:

- Identity: full name, email, phone, city/location, LinkedIn URL, Naukri profile URL
- Work: experience years, notice period, current CTC, expected CTC, work authorization
- Education: degree, institution, year (as available)
- Skills / target roles (from existing profile)
- Default portal password (AES-256-GCM with `APP_ENCRYPTION_KEY`; never returned in full to the client)
- Preferred resume file(s): default uploaded resume + optional per-job generated PDF/DOCX
- Short-answer preferences: notice period wording, relocation yes/no, etc.

If a **required** field has no vault value and cannot be safely derived, status → `needs_help` (do not guess salary/notice).

### Portal Classifier

Inputs: job URL, apply URL (if known), page HTML/DOM signals.

Outputs one of: `linkedin_easy` | `naukri_easy` | `greenhouse` | `lever` | `ashby` | `workday` | `smartrecruiters` | `unknown`.

Known Easy Apply / ATS types prefer playbook adapters; `unknown` uses the agent path.

### Auth Agent

1. Reuse `portal_connections` or a per-domain apply session if valid.
2. Else open login; fill vault email + default password.
3. If portal indicates no account, run signup with the same defaults (+ name/phone from vault).
4. Persist encrypted `storageState` for that domain on success.
5. CAPTCHA / OTP / checkpoint → `needs_help`.

### Form Mapper Agent

1. Inventory visible fields (label, name/id, type, required, options).
2. Map each to a vault key or generate a short JD-aware answer (reuse application-form-filler style rules: direct, specific, no fluff).
3. Produce an ordered fill plan for Executor.
4. Unmappable **required** field → `needs_help`.

### Executor Agent

Playwright only: navigate, fill, upload resume, click Next/Submit, detect success. Human-like delays. Per-job timeout (suggested **4 minutes**). On timeout → `needs_help` and continue queue.

### Playbook Memory

On `applied`, store a recipe keyed by `{ats_or_domain, flow_version}`: step graph / selectors / field map hints used. Next visit: try playbook first; if it fails validation, fall back to agents and refresh or retire the playbook.

### Application log

One `Application` document per `{user_id, job_posting_id}` (unique). Status, portal type, attempt count, screenshots/error snippets on non-success, timestamps. Feeds Activity UI and Needs Help queue.

## Data model (additions)

- `apply_vault` (1:1 user): structured fields above; `default_password_enc`; `match_threshold` (default 70); `auto_apply_enabled` (default false until vault complete); `daily_attempt_cap` (default 20).
- `applications`: `{user_id, job_id, status, portal_kind, playbook_id?, attempts, last_error, screenshot_refs[], created_at, updated_at, applied_at?}`. Statuses: `queued | classifying | authenticating | mapping_fields | executing | applied | needs_help | failed | skipped_cap`.
- `apply_playbooks`: `{key, ats_or_domain, steps, field_hints, success_count, fail_streak, status: active|retired}`.
- `domain_sessions`: like `portal_connections` but for arbitrary apply domains (encrypted storage state).
- Run kind: `auto_apply`. Run kinds already exist for crawl/portal; same claim/heartbeat rules; **one running `auto_apply` per user**.

Daily counter: count of applications that reached an Easy Apply / final Submit action (or equivalent) since midnight IST; when ≥ 20, remaining queue items → `skipped_cap` until next IST day.

## Data flow & status machine

1. After score ≥ threshold and `auto_apply_enabled` and vault ready → enqueue `Application` if none exists for that job.
2. Scheduler / `auto_apply` run drains `queued` while under daily cap.
3. Per job: `queued → classifying → authenticating → mapping_fields → executing → applied | needs_help | failed`.
4. Cap hit mid-run: remaining → `skipped_cap` (requeue next day automatically).
5. Resume file: per-job generated resume if present, else default vault resume.
6. Success: adapter-specific confirmation **or** generic thank-you / received copy + no empty required fields.
7. Retries: 2 for transient network/browser errors. `needs_help` = **manual retry only** from UI (no auto requeue).
8. Concurrency: one apply browser context per user; shared global browser slot limit with portal login windows.

## UI

- **Settings → Auto-apply**: toggle, match threshold, daily cap (read-only default 20 or editable ≤ 20), vault editor (identity, CTC, notice, password set/update — never show full stored password), “vault ready” checklist.
- **Jobs**: badge Applied / Needs help / Queued for auto-apply; filter by apply status.
- **Activity**: auto-apply run steps (classify, auth, map, execute) streamed like crawl logs.
- **Needs help** page/tab: list with job title, company, reason, last screenshot; actions **Retry** / **Skip forever** / **Mark applied manually**.

## Error handling

| Failure | Behavior |
|---|---|
| Session expired | Auth re-login; if fails → needs_help |
| CAPTCHA / OTP | needs_help immediately |
| Job closed / 404 | failed (no retry) |
| Playbook selector miss | fall back to agent path once; if still fail → needs_help; bump playbook fail_streak |
| Token budget exhausted | pause AI mapping; skip unknown portals; Easy Apply adapters may continue if no AI needed |
| Portal ban / unusual activity | needs_help + disable auto-apply for that portal/domain until user re-enables |

## Phased delivery

### Phase 1 — Foundation + Easy Apply (ship value first)

- Apply vault + settings UI + Application model + daily cap
- Orchestrator enqueue from score ≥ threshold
- Naukri Easy Apply adapter + LinkedIn Easy Apply adapter (session from `portal_connections`)
- Needs Help queue + Activity logging
- No generic portal agents yet

### Phase 2 — Generic portal agents

- Portal Classifier + Auth (login/signup) + Form Mapper + Executor
- Domain sessions + screenshot capture
- Default password create-account path

### Phase 3 — Playbooks + ATS adapters

- Persist successful flows as playbooks
- Greenhouse / Lever / Ashby / Workday / SmartRecruiters apply adapters when patterns stabilize
- Playbook retirement and fail_streak

## Testing

- Unit: classifier URL/HTML fixtures; field mapping from sample DOM → vault; status transitions and daily cap math (IST).
- Integration: mock Playwright pages for Naukri/LinkedIn Easy Apply happy path + CAPTCHA → needs_help.
- Manual: one real Naukri + one LinkedIn Easy Apply on a throwaway/test account before enabling on Anika’s profile; then one unknown careers page for Phase 2.

## Safety & compliance notes

- Credentials encrypted at rest; passwords never logged; apply screenshots retained with short TTL (e.g. 14 days).
- Auto-apply opt-in; default off until vault complete.
- Portals may restrict automated activity; keep 20/day and human-like delays; document account-risk in Settings.
- Users are responsible for accuracy of vault facts and for portal Terms of Service on their own accounts.

## Relation to existing code

- Reuse worker run queue, AI metering/budget, `apps/browser` session patterns, `portal_connections`, scoring pipeline, generated resumes.
- Explicitly **reverses** the earlier “No auto-apply” constraint in the portal-connections design for this feature set.
- Does not replace crawl/score; it consumes scored `job_postings`.
