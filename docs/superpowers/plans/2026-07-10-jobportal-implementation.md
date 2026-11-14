# Job Portal Implementation Plan

> **Goal:** Build a Dockerized full-stack job portal with Naukri crawler, LinkedIn sync, auto-apply, MongoDB, and visualization dashboard.

**Architecture:** Monorepo (`jobportal/`) with shared `core` + `db` packages, Express API, Playwright worker with hourly cron, React dashboard. LinkedIn `jobhunter/` CLI remains untouched.

**Tech Stack:** Node.js, Express, Mongoose, Playwright, node-cron, React + Vite, Docker Compose, MongoDB

---

## Phase 1 — Foundation (completed in this session)

- [x] Monorepo scaffold with npm workspaces
- [x] `@jobportal/core` — matcher, tier, freshness, profile loader
- [x] `@jobportal/db` — Mongoose models (Job, CrawlRun, CrawlLog, Application)
- [x] `@jobportal/api` — REST routes + SSE logs + Excel export
- [x] `@jobportal/worker` — Naukri crawler, LinkedIn sync, auto-apply, cron
- [x] `@jobportal/web` — Dashboard with Naukri/LinkedIn tabs, filters, live logs
- [x] `docker-compose.yml` — mongodb, api, worker, web

## Phase 2 — Next steps

- [ ] Run `npm run naukri:login` and add resume PDF to `create-resume/`
- [ ] `docker compose up --build` and verify first crawl
- [ ] Tune Naukri DOM selectors against live pages
- [ ] Add OTP/captcha fallback UI in portal
