# Job Crawler platform — design

Approved 2026-11-14. Supersedes `2026-11-14-multi-source-crawler-design.md` and the Naukri/LinkedIn VNC specs (snapshot kept on branch `legacy/naukri-vnc-snapshot`).

## Product

A public, multi-user job crawler. Anyone signs up (email + password, or Google). Each account is one job seeker with one profile. The user uploads a resume; AI extracts a structured profile; an AI web-search crawler finds matching jobs on any site every hour (or on demand) and scores them. Tailored resumes are generated **only when the user presses "Generate resume"** on a job. Optional Google Drive sync writes a "Job Matches" sheet (newest first) and uploads generated PDFs.

Removed: VNC auth browser, logged-in Naukri/LinkedIn crawlers, Naukri auto-apply and profile refresh, keyword library, global "active candidate", `linkedin-cli` from the app. Naukri/LinkedIn public listings still arrive through AI web search.

## Users and auth

- `User`: email (unique), name, password_hash (bcrypt, cost 12) and/or google_sub, role (`user`/`admin`, admins from `ADMIN_EMAILS`), status (`active`/`disabled`), session_version.
- Session: JWT `{sub, sv}` signed with `SESSION_SECRET` in httpOnly cookie `jc_session` (Secure in production, SameSite=Lax, 30 days). Every request reloads the user; disabled users or a bumped `session_version` are logged out.
- Google sign-in: OAuth scopes `openid email profile`; state in a short-lived signed cookie. Accounts link by verified email.
- No email service: admins reset passwords (one-time temporary password shown once) and disable users.
- Protection: helmet, `trust proxy`, Origin check on mutating requests, rate limits (auth 20/15 min/IP, API 600/15 min/IP), zod validation, 5 MB upload limit (PDF/DOCX only).

## Per-user AI settings

- Providers: `cursor` (Cursor SDK agent; web search via `webSearch`/`webFetch` tools) and `openai` (chat JSON + Responses API `web_search` tool). The user can store keys for both and picks one **active provider + model** that does all work (resume parsing, crawling, scoring, resume generation).
- Keys encrypted at rest with AES-256-GCM (`APP_ENCRYPTION_KEY`), only last 4 chars returned to the browser. Saving a key verifies it and loads the model list the key can use.
- Auth failures (401/403) stop the run with "Your <provider> key was rejected — update it in Settings" and flag the key.

## Data (new collections)

`users`, `profiles` (1:1 user: name, headline, contact, experience_years, target_roles, skills, target_locations, remote_ok, exclude_companies, career_pages, structured_resume, edited_by_user), `resumes` (original file bytes, extracted text with line breaks, parse_status), `job_postings` (user-scoped, unique `{user_id, job_url}`, dedupe_key, match {score, relevancy, summary, keywords, ats_score, missing}, status new/saved/applied/hidden), `runs` (task queue: kind `parse_resume` | `crawl` | `generate_resume`, status, stage, counters, payload, heartbeat), `run_logs` (TTL 30 days), `generated_resumes` (resume JSON, PDF bytes, ATS before/after, Drive link).

## Worker

- Polls `runs` every 5 s; claims atomically; max `MAX_CONCURRENT_RUNS` (default 3) and one running run per user per kind. Heartbeat every 30 s; stale runs (no heartbeat for 10 min) and runs interrupted by restart are failed.
- Hourly cron (IST) queues a `crawl` for each active user with hourly enabled, a configured AI key, a parsed profile, no queued/running crawl, and under the daily cap (`crawler.daily_run_limit`, default 24).
- `parse_resume`: AI → structured resume + profile suggestions. Fills profile fields unless the user has edited them.
- `crawl`: web search batches from target roles × target locations, career pages (Greenhouse/Lever/Ashby JSON; others via AI search), filters (exclude companies, location, age), dedupe, store, score, Drive sheet sync.
- `generate_resume`: tailor from the uploaded resume with the truth guard (no new employers/titles/dates/numbers), render PDF (Playwright), store, upload to Drive when connected. Daily cap 30/user.

## Web (mobile-first SPA)

Routes: `/login`, `/signup`, `/onboarding` (1 Upload resume → 2 AI provider + key → 3 Review profile → 4 Start crawling), `/jobs` (newest-first cards, filters, detail sheet with summary, ATS gaps, Apply, Save/Applied/Hide, Generate resume, download), `/resume` (file, extracted profile editor), `/activity` (current run progress, history, logs), `/settings` (AI, schedule & search, career pages, Google Drive, account), `/admin` (users). Bottom navigation on phones, sidebar on desktop.

## Deployment

- Images: `api` (node:22-slim), `worker` (Playwright base, Node ≥ 22.13), `web` (Vite build inside Caddy; Caddy reverse-proxies `/api` to `api:4000`, automatic HTTPS for `SITE_ADDRESS`).
- `docker-compose.yml` (local build) and `docker-compose.prod.yml` (GHCR images). MongoDB with root auth, no public port, nightly `mongodump` backups kept 14 days.
- GitHub Actions: `ci.yml` (install, tests, web build on push/PR); `deploy.yml` (on `main`: build + push images to GHCR, copy compose file to the VPS over SSH, `docker compose pull && up -d`). Secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, optional `VPS_PORT`, `VPS_PATH`.

## Migration

`npm run migrate:legacy -w @jobportal/worker -- --email <account> --slug anika` copies the legacy candidate's roles, skills, career pages and exclude list (`Amazon`) plus legacy web/career-page jobs into that account. Legacy collections are left untouched.
