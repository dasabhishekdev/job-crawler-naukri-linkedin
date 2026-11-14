# Job Portal — noVNC Auth Browser Fix

**Date:** 2026-07-10  
**Status:** Approved and implemented

## Problem

- `auth-browser` service never deployed (interrupted Docker build)
- API stuck in duplicate/exited container state
- noVNC on :6080 unreachable; Browser Login tab non-functional
- Web serving stale build without auth UI

## Solution

Fix and deploy `auth-browser` with Xvfb + Playwright + x11vnc + noVNC, healthchecks on all services, API graceful degradation when auth-browser is down.

## Architecture

```text
Portal :3001 → iframe → auth-browser :6080 (noVNC)
API :4000 → auth-browser :5000 (open/save session)
Sessions → jobhunter/storageState.json + worker_data/naukri-storage-state.json
```

## Verification

1. `docker compose ps` — 5 services healthy
2. http://localhost:6080 — noVNC loads
3. Portal → Browser Login — live browser visible
4. Save Session — green badges
5. Run Crawl — jobs in Naukri tab
