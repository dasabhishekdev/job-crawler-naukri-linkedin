# AI Keyword Planner — Design Spec

**Date:** 2026-07-10  
**Status:** Approved (Approach 2)  
**Project:** job-crawler-naukri-linkedin (`job-crawler-naukri-linkedin/`)

## Problem

Crawlers use static keywords (`NAUKRI_KEYWORDS` env + `profile.json` `job_keywords`). They do not adapt based on the candidate's resume or what is working during a crawl. Users cannot see which query is active on Naukri vs LinkedIn.

## Goal

Replace static keyword lists with an AI-driven **Keyword Planner** that:

1. Reads an **uploaded resume** (PDF, DOCX, MD, TXT) from the UI
2. Generates **platform-specific** search queries (Naukri and LinkedIn independently)
3. Rotates to a new query after **N fresh valid jobs** from the current query (default 5, configurable in UI)
4. Stops when the run reaches the existing **target fresh jobs** limit (default 20)
5. Shows **live current queries** on the UI for both platforms

## Non-Goals

- Multi-user auth / per-user resume storage (single-user local deployment)
- Replacing `profile.json` for job matching/scoring (matcher still uses profile)
- Fine-tuning or custom OpenAI assistants

## Decisions (from brainstorming)

| Decision | Choice |
|----------|--------|
| Resume source | UI upload (not disk-only) |
| File formats | PDF, DOCX, Markdown, plain text |
| Rotation trigger | After N **fresh + valid_open** jobs per keyword |
| Default N | 5 (configurable in UI, range 1–10) |
| Platform queries | Separate Naukri and LinkedIn queries |
| Architecture | Approach 2 — central Keyword Planner module |
| OpenAI model | `gpt-4o-mini` |
| API key storage | `OPENAI_API_KEY` in `.env` only — never committed |

## Architecture

```
┌─────────────┐     upload      ┌──────────────┐
│  Web UI     │ ──────────────► │  API         │
│  Settings   │                 │  /api/resume │
└──────┬──────┘                 └──────┬───────┘
       │ poll progress                 │ parse + store
       │                               ▼
       │                        ┌──────────────┐
       │                        │ MongoDB      │
       │                        │ ResumeProfile│
       │                        └──────────────┘
       │
       ▼
┌─────────────┐   next query    ┌──────────────────┐
│ Crawlers    │ ◄────────────── │ Keyword Planner  │
│ naukri.js   │                 │ (@jobportal/core)│
│ linkedin.js │ ── fresh count ►│ + OpenAI API     │
└─────────────┘                 └──────────────────┘
       │
       ▼
  CrawlRun.naukri_current_query / linkedin_current_query
```

### Keyword Planner (`packages/core/src/keyword-planner.js`)

Single module responsible for:

- `parseResume(buffer, filename)` → plain text
- `generateNextQuery({ resumeText, platform, usedQueries, recentStats, location })` → `{ query, reasoning }`
- `createPlanner({ resumeText, config })` → stateful planner instance per crawl run

**Prompt strategy:**

- Input: resume excerpt, platform name, used queries (dedupe), per-query fresh counts, location
- Output: JSON `{ "query": "...", "reasoning": "..." }`
- Naukri: short 2–4 word job-title style queries
- LinkedIn: slightly longer, can include skill combos

**Fallback:** On OpenAI failure (timeout, rate limit, missing key), fall back to `profile.json` `job_keywords` / env `NAUKRI_KEYWORDS`. Log warning; crawl continues.

### Rotation logic (both crawlers)

```
planner = createPlanner(resumeText, { threshold, location })
freshFromCurrentQuery = 0
listingsWithoutFresh = 0

while !shouldStopCrawl(runId):
  if !currentQuery || freshFromCurrentQuery >= threshold:
    currentQuery = await planner.next(platform)
    updateCrawlProgress({ [`${platform}_current_query`]: currentQuery })
    freshFromCurrentQuery = 0
    listingsWithoutFresh = 0

  fetch + validate listings for currentQuery
  on fresh+valid_open: freshFromCurrentQuery++
  on no fresh after 20 listings: force rotate (don't wait for threshold)

  if shouldStopCrawl: break
```

### Data model

**ResumeProfile** (new collection):

```javascript
{
  filename: String,
  mime_type: String,
  text: String,          // extracted plain text
  uploaded_at: Date,
  is_active: Boolean,    // latest upload = true
}
```

**CrawlRun** (new fields):

```javascript
{
  resume_id: ObjectId,
  fresh_per_keyword_threshold: Number,  // default 5, from UI
  naukri_current_query: String,
  linkedin_current_query: String,
  naukri_queries_used: [String],
  linkedin_queries_used: [String],
  naukri_fresh_from_query: Number,
  linkedin_fresh_from_query: Number,
}
```

**SearchSettings** (optional persisted UI prefs in MongoDB or localStorage):

- `fresh_per_keyword_threshold` (default 5)
- Last active resume filename (display only)

### API endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/resume/upload` | Multipart upload, parse, store, set active |
| GET | `/api/resume/active` | Return active resume metadata (not full text) |
| POST | `/api/keywords/preview` | Generate sample Naukri + LinkedIn query without crawl |
| POST | `/api/crawl/trigger` | Accept `fresh_per_keyword_threshold` in body |

Progress endpoints (`/api/crawl/progress/:runId`, live-status) return current queries + fresh-from-query counts.

### UI

**Search Settings panel** (Dashboard or dedicated tab):

- Resume dropzone (PDF/DOCX/MD/TXT, max 5 MB)
- Active resume indicator
- Number input: "Fresh jobs per keyword" (1–10, default 5)
- "Preview keywords" button
- Crawl trigger passes threshold to API

**Live crawl banner** (Browser Login + header stats):

```
Naukri:   "supply chain analyst"     3/5 fresh from query
LinkedIn: "operations analyst"       1/5 fresh from query
Overall:  12/20 fresh jobs
```

### Error handling

| Scenario | Behavior |
|----------|----------|
| No resume uploaded | Block crawl; show upload prompt |
| Parse failure | 400 with message; don't store |
| OpenAI unavailable | Fallback static keywords; log warn |
| 0 fresh after 20 listings | Auto-rotate query |
| Force stop | Queries preserved on CrawlRun record |

### Security

- `OPENAI_API_KEY` only in `.env` / docker-compose env reference
- Resume text stored in MongoDB (local deployment)
- Upload size limit 5 MB
- No API key in frontend or git

### Dependencies (new)

- `openai` — official SDK
- `pdf-parse` — PDF text extraction
- `mammoth` — DOCX to text
- `multer` — multipart upload in API

### Testing

- Unit: `parseResume` for each format, `generateNextQuery` mock OpenAI
- Integration: upload → preview keywords → trigger crawl with threshold
- Manual: live crawl shows rotating queries in UI

## Success criteria

1. User uploads resume via UI; crawl uses AI queries (not static env list)
2. Naukri and LinkedIn show **different** live queries on UI
3. Query rotates after configurable fresh-job threshold (default 5)
4. Crawl still stops at 20 total fresh jobs (existing behavior)
5. OpenAI failure does not crash crawl (fallback works)
