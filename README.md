# Job Portal

Full-stack job crawler for **Naukri** and **LinkedIn** with auto-apply, MongoDB, Docker, and a visualization dashboard.

## Quick Start

```bash
cd jobportal
cp .env.example .env
npm install
docker compose up --build
```

- **Dashboard:** http://localhost:3000
- **API:** http://localhost:4000
- **MongoDB:** localhost:27017

## Naukri Login (required for auto-apply)

Before auto-apply works, save your Naukri session:

```bash
cd jobportal
npm install
npm run naukri:login -w @jobportal/worker
```

Log in manually in the browser, then press Enter. Session is saved to `apps/worker/data/naukri-storage-state.json`.

## Resume Folder

Place your resume PDF in `../create-resume/` (mounted into Docker). MD files in that folder are used as reference context.

## Manual Crawl

```bash
# Via portal: click "Run Crawl Now"
# Or CLI:
npm run crawl -w @jobportal/worker -- --once
```

## Architecture

| Service | Port | Role |
|---------|------|------|
| web | 3000 | React dashboard |
| api | 4000 | REST API + SSE logs |
| worker | — | Hourly cron + Playwright crawlers |
| mongodb | 27017 | Job storage |

## LinkedIn Safety

The existing `jobhunter/` CLI is **not modified**. The worker syncs jobs from `jobhunter/jobs.db` into MongoDB for the LinkedIn tab.

## Hourly Pipeline

1. **Discover** jobs on Naukri (profile keywords × Bengaluru)
2. **Freshness filter** — skip jobs older than 14 days
3. **Validate** — check listing + external URLs
4. **Match & tier** — profile-based scoring
5. **Auto-apply** — Naukri tier 1/2 jobs (max 10/run)
6. **Sync** LinkedIn jobs from existing crawler DB

## Export

- Portal: **Export Excel** button
- API: `GET /api/export/excel?source=naukri`
