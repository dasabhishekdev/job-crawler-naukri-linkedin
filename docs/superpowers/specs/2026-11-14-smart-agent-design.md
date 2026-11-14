# Smarter crawl agent, memory and token usage — design

Approved 2026-11-14.

## Goals

1. The agent plans its own search keywords from the resume/profile and learns which ones produce jobs.
2. It discovers relevant companies, verifies their official career pages, adds them to the user's target companies, and crawls them deeply — preferring free paths (ATS JSON APIs, structured data) over AI.
3. It remembers where it has been (queries, companies, visited pages) and uses that memory to avoid waste.
4. Every AI call is metered; users see tokens and an estimated cost, and a daily token budget pauses AI-heavy steps.

## Facts this relies on

- Cursor runs return exact `usage` (input/output/cache tokens). `agent.getUsage()` cost is not available for this account, and there is no API for the weekly pool. Cost is therefore an **estimate at list price**; the real remaining pool is on the Cursor/Grok dashboard (linked).
- Cursor's own models (Composer 2.5, Grok 4.5/4.6/4.7) are included in paid plans' weekly pool; Composer 2.5 is the cheapest ($0.50 in / $2.50 out per 1M). Third-party models bill at API price.
- A minimal Cursor agent turn costs ~3.2k input tokens of fixed overhead, so batching matters.

## Components

- **Search planner** (`search_queries`): AI generates 20–30 job queries (title variants, skills, domain/industry) and 6–10 company-discovery queries per profile version (hash of roles, skills, cities, years). Each query tracks uses, results, new jobs, good matches. Selection favours yield with an exploration bonus; queries with 4 uses and 0 new jobs retire. Re-plan when the profile hash changes or fewer than 6 active job queries remain. Users can add or retire queries.
- **Company discovery** (daily, while fewer than `max_companies` = 40 AI-found companies): AI search returns companies hiring for the profile in the user's cities with official careers URLs. Each URL is fetched; final URL/HTML is checked for a known ATS. Verified companies are appended to `profile.career_pages` with `source: "ai"`, `reason`, `ats`.
- **Career crawl** (each run, the 10 most stale enabled pages not crawled in 12 h and with < 5 consecutive failures): Greenhouse, Lever, Ashby, **Workday**, **SmartRecruiters** via JSON APIs; other sites via the worker's Chromium (collect job links by URL pattern and title match, open up to 12, read JSON-LD `JobPosting` or page text). AI fallback only when a generic page yields nothing (max 2 per run, within budget).
- **Memory** (`visited_pages`, TTL 90 days): url, domain, kind (careers, job, search), visits, last status, jobs found. Job pages already stored are not reopened; failing sites back off.
- **Ingest hardening**: dead-link check (404/410 dropped) for web-search results, title prefilter, attribution of jobs to the query that found them.
- **AI robustness**: retry transient errors (429, 5xx, timeouts, network) twice with backoff; one retry when JSON is invalid; key errors never retried.
- **Usage** (`ai_usage`, TTL 180 days): provider, model, purpose, tokens, duration, estimated cost, run. `daily_token_budget` (default 1.5M) checked before each AI call; when exceeded, AI steps are skipped with a log line and free crawls continue.

## UI

- Activity: tabs **Live**, **History**, **Memory** (Companies, Keywords, Visited pages).
- Settings → AI provider: **Usage** panel (today vs budget, last 7 days, by purpose, estimated cost, plan note and dashboard link); model list marks plan-included Cursor models and shows list price.
- Settings → Search: daily token budget, company discovery on/off, career pages per run.
- Target companies list: "AI found" badge with reason, ATS type, total jobs found.
