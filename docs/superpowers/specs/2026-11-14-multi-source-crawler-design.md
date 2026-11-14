# Multi-source hourly crawler + Google Drive sync — design

Approved 2026-11-14.

## Goal

For the profile selected in the dashboard, crawl jobs every hour from any site (not only Naukri/LinkedIn), score them against the resume, keep the relevant ones in a Google Sheet (newest first), and upload an ATS-tailored PDF resume to Drive when the profile fits but the resume misses the JD's keywords.

## Sources

| Source | `Job.source` | How |
|---|---|---|
| Web agent | `web` | Cursor SDK local agent (`@cursor/sdk`, `CURSOR_API_KEY`) runs web search per query batch and returns a JSON array of open postings (boards + company career pages). |
| Career pages | `career_page` | Per-candidate list of careers URLs. Greenhouse / Lever / Ashby boards use their public JSON APIs; any other URL goes to the Cursor agent ("open this page, list matching openings"). |
| Naukri / LinkedIn | unchanged | Existing crawlers and the 09:00/19:00 Naukri agent stay as they are. |

Search location for the multi-source crawl: **Bengaluru only** (`crawler.location`, default `Bengaluru, Karnataka, India`).
Companies in `config/blocklist.json` are skipped everywhere.

Dedupe per candidate: normalized apply URL, then `dedupe_key = company|title` (lowercase, punctuation stripped) across all sources. Only new jobs are scored.

## Scoring

One LLM JSON call per job (OpenAI via existing `chatJson` when a key is configured, otherwise the Cursor agent):
`fit` (0–100), `relevancy` (High/Medium/Low), `summary` (2–3 lines), `keywords` (top ≤20 JD hard skills/terms).

`ats_score` is computed in code: share of `keywords` present in the resume text (normalized, with simple synonym/plural handling). Missing ones are stored as `ats_missing`.

A job is **relevant** when `fit >= crawler.min_fit_to_sync` (default 50). Relevant jobs go to the sheet.

## Tailored resume

Trigger: `fit >= 70` and `ats_score < 75` (configurable).

1. Pick the base resume (`.md` files listed in `candidate.tailor_base_resumes`, else all `*Resume*.md` in the resume dir) with the highest ATS coverage for this JD.
2. LLM returns a structured resume JSON (header, summary, highlights, skills groups, experience, education, extras). Rules: rephrase/reorder only; never add employers, titles, dates, degrees, tools or metrics not in the base resume.
3. Guard: every experience company/title/dates must exist in the base resume text, otherwise discard.
4. Render HTML → PDF with Playwright Chromium (A4, ATS-safe single column). Re-score ATS on the tailored text.
5. Upload PDF to Drive `Job Crawler/<Name>/Tailored Resumes/<Company> - <Title>/`.

## Google Drive / Sheets

OAuth (web client, scope `https://www.googleapis.com/auth/drive.file` only). Client id/secret from `.env`; refresh token stored in `AppSettings("google")`. Settings page: Connect / Disconnect.

Per candidate (ids stored on `Candidate.drive`): folder `Job Crawler/<Name>/`, spreadsheet `<Name> – Job Matches`, folder `Tailored Resumes/`.

Sheet tab `Jobs`, rewritten after each run, sorted by `first_seen_at` desc:
Added (IST) · Match % · ATS % · Relevancy · Company · Job Title · Location · Source · Apply Link · Summary · Tailored Resume · Tailored ATS % · Status.

## Scheduling and UI

- `AppSettings("crawler").data`: `hourly_enabled`, `sources {web_agent, career_pages}`, `location`, thresholds, `max_agent_batches`.
- Worker cron `0 * * * *` (Asia/Kolkata) queues a `CrawlRun{source:"multi"}` for the active candidate when `hourly_enabled`. "Run now" queues the same. Skips if any run is already running.
- New **All Sources** tab: start/stop hourly, run now, source toggles, career pages editor, run status/log, jobs table (newest first) with Match/ATS/Relevancy/Summary/Apply/Resume links, Open sheet.
- Settings: Cursor key status, Google connect status.

## Runtime

Worker image must run Node ≥ 22.13 (SDK requirement). Agent workspace `DATA_DIR/cursor-agent`. Secrets only in `.env`.

## Error handling

- Agent batch failure → log + continue other batches; run still completes.
- Drive not connected → jobs still stored/scored; sheet sync and upload skipped with a warning.
- Tailor failure → job keeps `tailored_status: "failed"` + error; retried next run (max 2 attempts).
