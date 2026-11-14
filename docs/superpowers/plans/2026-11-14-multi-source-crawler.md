# Multi-source crawler Implementation Plan

**Goal:** Hourly any-site job crawl for the selected profile, scored and synced newest-first to a Google Sheet, with ATS-tailored PDFs uploaded to Drive.

**Architecture:** New `packages/google` (OAuth, Drive, Sheets) shared by API and worker. New `apps/worker/src/multi/` (Cursor agent discovery, career-page adapters, scoring, tailoring, run orchestration). API gets `routes/google.js` and `routes/multi.js`; web gets an All Sources tab and integration settings.

**Tech Stack:** Node (worker ≥ 22.13), `@cursor/sdk`, `googleapis`, Playwright, Mongoose, React/Vite. Spec: `docs/superpowers/specs/2026-11-14-multi-source-crawler-design.md`.

## Global Constraints

- CommonJS everywhere except `apps/web` (ESM).
- Secrets only from `.env` / Mongo; never logged.
- Google scope: `drive.file` only.
- Location: Bengaluru only. Blocklist `config/blocklist.json` applies.
- Tailoring is truthful: no new employers, titles, dates, degrees, tools, metrics.

## Tasks

1. **DB schema** — `packages/db/src/index.js`: Job source enum + `web`/`career_page`; fields `source_site, summary, relevancy, fit_score, ats_score, ats_keywords, ats_missing, dedupe_key, first_seen_at, tailored {status, attempts, error, base_resume, ats_score, drive_file_id, drive_url, folder_url}`; CrawlRun source `multi` + counters; Candidate `career_pages`, `tailor_base_resumes`, `drive`; AppSettings `data: Mixed`.
2. **Pure helpers + tests** — `apps/worker/src/multi/normalize.js` (URL normalize, dedupe key, JSON array extraction, blocklist), `ats.js` (keyword coverage), `career-boards.js` URL detection; `node --test` tests in `apps/worker/test/`.
3. **Cursor agent wrapper** — `multi/cursor-agent.js`: `runAgentJson(prompt, {timeoutMs})` using `Agent.prompt`, local cwd `DATA_DIR/cursor-agent`.
4. **Discovery** — `multi/web-search.js` (query batches from profile → agent), `multi/career-pages.js` (Greenhouse/Lever/Ashby JSON + generic via agent).
5. **Scoring** — `multi/score.js`: LLM JSON (OpenAI `chatJson` or Cursor fallback) + ATS compute.
6. **Tailoring** — `multi/tailor.js` (structured resume JSON + guard) and `multi/resume-pdf.js` (HTML template → Playwright PDF).
7. **Google package** — `packages/google/src/{oauth,drive,sheets,index}.js`.
8. **Run orchestration** — `multi/run-multi.js`; wire into `pipeline.processPendingRuns` and hourly cron in `apps/worker/src/index.js`; crawler settings helpers in `packages/agent/src/crawler-settings.js`.
9. **API** — `routes/google.js` (status, auth-url, callback, disconnect), `routes/multi.js` (settings, run, status, career pages); fix `job-filter.js`.
10. **Web** — `AllSources.jsx`, `IntegrationsSettings.jsx`, api client methods, tab wiring, styles.
11. **Infra/docs** — worker Dockerfile Node 22, compose env, `.env.example`, README Google setup.
12. **Verify** — unit tests, `node --check`, web build, docker build + live run.
