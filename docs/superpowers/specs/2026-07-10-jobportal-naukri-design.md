# Job Portal — Naukri + LinkedIn Design Spec

**Date:** 2026-07-10  
**Project:** `jobportal/`  
**Status:** Approved — implementation in progress

## Problem

Job hunting across Naukri and LinkedIn is manual, fragmented, and time-consuming. The existing `jobhunter/` CLI handles LinkedIn but has no portal, no Naukri support, no cron automation, and no auto-apply.

## Goals

| Goal | Detail |
|------|--------|
| Naukri crawler | Search, scrape, validate, match, auto-apply |
| LinkedIn safety | Keep `jobhunter/` CLI working; sync into portal via adapter |
| Freshness | Jobs older than 14 days marked stale/dead |
| Volume | 40–50 valid jobs per hourly crawl run per source |
| Matching | Reuse profile-based scoring from `jobhunter` |
| Portal | Tabs for Naukri + LinkedIn, filters, Excel export, live logs |
| Infrastructure | Docker Compose, MongoDB, local deployment |

## Architecture

```text
web:3000 ──► api:4000 ──► MongoDB
                ▲
worker (cron) ──┘  Playwright crawlers
resume/ volume mounted for PDF apply
```

## Non-Goals (Phase 1)

- Cloud deployment
- Multi-user auth
- OTP/captcha automation (fail gracefully, manual re-login)

## User Decisions

- Full auto-apply on Naukri (tier 1/2, rate-limited)
- Unified portal with separate tabs
- Resume from `create-resume/` folder (PDF + MD reference)
- Naukri session persistence (like LinkedIn storageState)
- Local Docker only
