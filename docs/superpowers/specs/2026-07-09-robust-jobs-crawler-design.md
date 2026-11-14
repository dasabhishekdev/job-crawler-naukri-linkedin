# Robust LinkedIn Jobs Crawler — Design Spec

**Date:** 2026-07-09  
**Project:** `jobhunter/`  
**Status:** Approved for implementation planning

## Problem

The current jobs crawler (`npm run crawl:jobs`) has three critical gaps:

1. **Volume cap** — LinkedIn loads ~25 job cards per search; scrolling alone does not paginate. Last run saved only 25 jobs before stopping.
2. **Fragility** — Crawl crashed on keyword #2 with `ERR_HTTP_RESPONSE_CODE_FAILURE` (rate limit / session), losing progress.
3. **No URL validation** — Jobs are saved without checking if the link still works or if the role is still accepting applications.

## Goals

| Goal | Detail |
|------|--------|
| **Target volume** | ≥ 100 **validated open** jobs per crawl run |
| **URL validity (A)** | Page loads and shows a real job (not 404 / unavailable) |
| **URL validity (B)** | Job is still accepting applications (exclude closed/expired) |
| **Relevance (tiered)** | Tier 1: profile-matched first; Tier 2: keyword-only to fill remaining slots |
| **Robustness** | Resumable after crashes, retry on rate limits, checkpoint per keyword+page |

## Non-Goals

- External career-site apply flow automation
- Feed/post scraping changes (out of scope for this spec)
- Parallel multi-account crawling
- AI-based relevance scoring

## Recommended Approach

**Pipeline with job states (Approach 2)** — split crawl into Discover → Validate → Tier → Export with SQLite state tracking. Resumable, retry-friendly, and fits the tiered relevance model without over-engineering.

## Architecture

```text
┌─────────────┐     ┌──────────────┐     ┌─────────────┐     ┌────────────┐
│  Discovery  │ ──► │  Validation  │ ──► │   Tiering   │ ──► │  Export    │
│  (search +  │     │  (visit URL, │     │  (profile   │     │  (100+     │
│  pagination)│     │  open/closed)│     │   vs keyword)│     │   open jobs)│
└─────────────┘     └──────────────┘     └─────────────┘     └────────────┘
       │                    │                    │
       └────────────────────┴────────────────────┘
                         jobs.db
                    (state per job URL)
```

### Pipeline Stages

1. **Discovery** — For each keyword × page offset, collect job card URLs and minimal metadata. Mark as `discovered`.
2. **Validation** — Visit each `discovered` or `error` URL with Playwright + session. Set `url_status`.
3. **Tiering** — Score relevance; assign `tier` (1 or 2). Only `valid_open` jobs count toward target.
4. **Export** — Output validated open jobs, tier-sorted.

### Crawl Loop Termination

Keep discovering across keywords and page offsets until:

```
count(valid_open AND tier=1) + count(valid_open AND tier=2) >= TARGET_JOBS (100)
```

Tier 1 jobs are prioritized in export; Tier 2 fills remaining slots up to 100.

## Data Model

### `jobs` table (extend existing)

| Column | Type | Description |
|--------|------|-------------|
| `job_url` | TEXT UNIQUE | Primary dedup key |
| `job_id` | TEXT | Parsed from URL |
| `job_title` | TEXT | |
| `company` | TEXT | |
| `location` | TEXT | |
| `description` | TEXT | |
| `search_keyword` | TEXT | Keyword that discovered this job |
| `match_score` | INTEGER | Profile relevance score |
| `match_reasons` | TEXT | JSON array |
| `tier` | INTEGER | 1 = profile-matched, 2 = keyword-only |
| `url_status` | TEXT | `discovered`, `valid_open`, `valid_closed`, `dead`, `error` |
| `apply_type` | TEXT | `easy_apply`, `external`, `unknown` |
| `validation_attempts` | INTEGER | Retry counter (max 3) |
| `validated_at` | TEXT | ISO timestamp |
| `scraped_at` | TEXT | First seen timestamp |

### `crawl_checkpoint` table (new)

| Column | Type | Description |
|--------|------|-------------|
| `keyword` | TEXT | Last completed keyword |
| `page_offset` | INTEGER | Last completed `start` param (0, 25, 50…) |
| `location` | TEXT | Search location used |
| `updated_at` | TEXT | |

On resume, skip keyword+page combinations already checkpointed.

## Discovery Strategy

### Pagination (fixes 25-job cap)

LinkedIn Jobs search supports `start` query param:

```
https://www.linkedin.com/jobs/search/?keywords=supply+chain&location=Bangalore&start=0
https://www.linkedin.com/jobs/search/?keywords=supply+chain&location=Bangalore&start=25
https://www.linkedin.com/jobs/search/?keywords=supply+chain&location=Bangalore&start=50
```

- Increment `start` by 25 per page
- Stop per keyword when a page returns 0 new job cards or `start` exceeds configurable max (default 200)
- Dedup by `job_id` across all keywords and pages

### Keyword rotation

Use `profile.json` → `job_keywords` (12 keywords). Rotate through all keywords before expanding location.

### Location fallback (configurable)

If validated open count < 100 after all keywords × pages in primary location:

1. Primary: `Bangalore, Karnataka, India` (default)
2. Fallback: `Karnataka, India`
3. Fallback: `India`

Only trigger fallback when primary location exhausted.

## URL Validation

Use **Playwright with saved `storageState.json`** — plain HTTP requests fail on LinkedIn (login walls, 999 responses).

### Per-URL checks

| Condition | `url_status` |
|-----------|--------------|
| Redirect to `/login` or auth wall | `error` (retry later) |
| Text: "No longer accepting applications" | `valid_closed` |
| Text: "Job no longer available" | `dead` |
| Text: "Page not found" / 404 indicators | `dead` |
| `h1` job title present + apply CTA visible | `valid_open` |

### Apply type detection

| Signal | `apply_type` |
|--------|--------------|
| "Easy Apply" button | `easy_apply` |
| "Apply" linking off LinkedIn | `external` |
| Neither detected | `unknown` |

### Retry policy

- `error` jobs: retry up to 3 times with exponential backoff (5s, 15s, 45s)
- After 3 failures: leave as `error`, log warning, continue crawl

## Tiered Relevance

| Tier | Criteria | Fill order |
|------|----------|------------|
| **Tier 1** | `match_score >= 5` | First |
| **Tier 2** | `match_score >= 1` | Fill remaining slots to 100 |

Jobs with `match_score < 1` are discovered but never counted toward the 100 target.

Scoring uses existing `analyzeJob()` from `src/jobs/parser.js` (roles +3, skills +1, location +2, keyword +2).

## Robustness & Error Handling

| Scenario | Behavior |
|----------|----------|
| `ERR_HTTP_RESPONSE_CODE_FAILURE` on search | Retry 3× with backoff; skip keyword if still failing |
| Rate limit suspected | Pause 60s, resume from checkpoint |
| Session expired (login redirect) | Stop crawl with message: `npm run login` |
| Keyword returns 0 new jobs | Move to next keyword |
| Total valid_open < 100 after exhaustion | Export what exists + write shortfall report |

### Timing

- Random delay 2–4s between page navigations
- Random delay 1–2s between job URL validations
- Configurable via `SCROLL_DELAY_MS`, `VALIDATE_DELAY_MS`

## CLI

| Command | Purpose |
|---------|---------|
| `npm run crawl:jobs` | Full pipeline: discover → validate until ≥ 100 open |
| `npm run validate:jobs` | Re-validate existing `discovered` / `error` / stale jobs |
| `npm run export:jobs` | Export validated open jobs only |

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TARGET_JOBS` | `100` | Minimum validated open jobs |
| `JOB_LOCATION` | `Bangalore, Karnataka, India` | Primary search location |
| `MAX_PAGES_PER_KEYWORD` | `8` | Pages × 25 = up to 200 jobs/keyword |
| `TIER1_MIN_SCORE` | `5` | Profile-matched threshold |
| `TIER2_MIN_SCORE` | `1` | Keyword-only threshold |
| `VALIDATE_DELAY_MS` | `1500` | Delay between URL checks |

## Export Outputs

| File | Contents |
|------|----------|
| `jobs-export.json` | Full records for `valid_open` jobs, tier-sorted |
| `jobs-urls.txt` | One open job URL per line |
| `jobs-report.txt` | Summary: open/closed/dead counts, tier breakdown, shortfall if any |

## File Changes (implementation scope)

| File | Action |
|------|--------|
| `src/jobs/search.js` | Add `start` pagination param to search URL |
| `src/jobs/validator.js` | **New** — URL validation logic |
| `src/jobs/discovery.js` | **New** — paginated discovery loop |
| `src/crawl-jobs.js` | Refactor to pipeline orchestrator |
| `src/validate-jobs.js` | **New** — standalone re-validation |
| `src/storage/jobs-db.js` | Extend schema + checkpoint + status queries |
| `src/export-jobs.js` | Filter `valid_open` only; add report |
| `src/config.js` | New config keys |
| `package.json` | Add `validate:jobs` script |

## Testing Plan

1. **Unit:** `validator` classifies mock HTML snippets (open / closed / dead)
2. **Unit:** pagination URL builder produces correct `start` offsets
3. **Unit:** tier assignment from match scores
4. **Integration:** single keyword, 2 pages → discovers > 25 unique URLs
5. **Integration:** validate 5 known URLs (mix of open/closed)
6. **Manual:** full crawl with `TARGET_JOBS=10` smoke test before running 100

## Risks

| Risk | Mitigation |
|------|------------|
| LinkedIn account restriction | Low volume, delays, single session, no parallel requests |
| DOM selector changes | Multiple fallback selectors (existing pattern) |
| < 100 open jobs in niche | Location fallback + more keywords in `profile.json` |
| Stale jobs between crawl and apply | `validate:jobs` command for refresh |

## Success Criteria

- [ ] Crawl discovers > 25 jobs per multi-page keyword search
- [ ] Crawl resumes after simulated crash (checkpoint works)
- [ ] Each saved job has `url_status = valid_open`
- [ ] Export contains ≥ 100 jobs when market has sufficient listings
- [ ] Tier 1 jobs appear before Tier 2 in export
- [ ] `jobs-report.txt` shows accurate open/closed/dead breakdown
