# Job crawler (Naukri + LinkedIn)

Daily Naukri agent with Mission Control UI: profile bump, AI job discovery, ranking, and auto-apply.

## Layout

```
job-crawler/
  apps/            API, web dashboard, worker, auth browser
  packages/        core, db, agent
  config/          fallback search profile
  linkedin-cli/    LinkedIn feed crawler (jobs.db + session)
```

Resumes are mounted from `../anika-resume/` and `../tanmoy-resume/`. Switch candidates in the UI header.

## Quick start

```bash
cd job-crawler
cp .env.example .env
# Put OPENAI_API_KEY in .env — do not commit it
npm install
docker compose up --build
```

- **Mission Control:** http://localhost:3006
- **API:** http://localhost:4000
- **MongoDB:** localhost:27017

## All Sources (hourly, any site)

The **All Sources** tab crawls jobs for the profile selected in the header, every hour at :00 IST once **Crawl every hour** is on (or on demand with **Run now**).

1. **Web agent:** a Cursor SDK agent (`CURSOR_API_KEY`) web-searches job boards and company career pages (Indeed, Foundit, Instahyre, iimjobs, apna, Workday/Greenhouse/Lever sites, and others) for the profile's target roles in Bengaluru. Each run rotates through the roles.
2. **Career pages:** the companies in **Target company career pages**. Greenhouse, Lever and Ashby boards are read from their public JSON APIs; other careers sites are opened by the agent.
3. **Scoring:** each new job gets a match %, relevancy, a short summary and its ATS keywords (OpenAI if a key is set, otherwise Cursor). The ATS % is the share of those keywords found in the resume.
4. **Tailored resume:** when match ≥ 70% and ATS < 75%, the closest base resume (`.md`) is rewritten with the job's wording. It never adds employers, titles, dates or numbers that are not in the base resume. The PDF is uploaded to Drive.
5. **Google Sheet:** `Job Crawler/<Name>/<Name> – Job Matches` is rewritten after every run, newest jobs first. Tailored PDFs go to `Job Crawler/<Name>/Tailored Resumes/<Company> - <Title>/`.

Companies in `config/blocklist.json` are skipped everywhere. Thresholds and location live in **Settings → Crawler thresholds**.

One-off run without the UI: `npm run multi -w @jobportal/worker` (needs Node 22.13+ and MongoDB).

### Google Drive setup (once)

1. In [Google Cloud Console](https://console.cloud.google.com/) create a project, then enable **Google Drive API** and **Google Sheets API**.
2. **OAuth consent screen:** External; add your Gmail as a test user; then **Publish app**. The app only asks for `drive.file` (files it creates), so publishing needs no verification and avoids Google's 7-day token expiry for test apps.
3. **Credentials → Create OAuth client ID → Web application.** Authorized redirect URI: `http://localhost:4000/api/google/oauth/callback`.
4. Put the client ID and secret in `job-crawler/.env`:

   ```bash
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   ```

5. `docker compose up -d --build`, open **Settings → Connect Google Drive**, and approve.

## Daily agent

The worker runs the active candidate at **09:00 and 19:00 IST**:

1. Check Naukri session
2. Refresh profile (re-upload resume + headline)
3. Discover jobs with AI queries
4. Rank with AI match score
5. Auto-apply Naukri jobs scoring 70+ (max 20/day)

From the UI: select a candidate, open **Browser Login**, save the Naukri session, then **Run Daily Agent**.

```bash
npm run agent -w @jobportal/worker
```

## LinkedIn

LinkedIn is crawl-only (no auto-apply). The CLI lives in `linkedin-cli/`.

```bash
cd linkedin-cli
npm install
npm run login
npm run crawl:jobs
```

## Architecture

| Service | Port | Role |
|---------|------|------|
| web | 3006 | Mission Control dashboard |
| api | 4000 | REST API + SSE agent events |
| worker | — | 09:00/19:00 IST cron + Playwright |
| mongodb | 27017 | Jobs, candidates, agent events |

## Export

- Portal: **Export Excel**
- API: `GET /api/export/excel?source=naukri`
