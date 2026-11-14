# Phase 2 — Connect Naukri / LinkedIn — design

Approved 2026-11-14. Builds on `2026-11-14-job-crawler-platform-design.md`.

## Goal

Users connect their own LinkedIn and/or Naukri account through a private in-app login window. The platform then crawls, with that session, each portal's **recommended jobs** and a **search for the user's target roles and cities**, every 3 hours (opt-in) or on demand. Optional daily Naukri profile refresh (re-upload the current resume). No auto-apply.

## Login window (new `apps/browser` service)

- Internal-only Node service (Playwright base image) with one headless Chromium. Each login is a fresh incognito `BrowserContext`, never written to disk.
- Auth: the API issues a single-use ticket (`POST /api/portals/:portal/connect`, 32 random bytes, SHA-256 stored, 60 s TTL, bound to user + portal + viewport). The SPA opens `wss://<site>/api/portals/ws?ticket=…`; Caddy routes that path to `browser:5100`, which checks the Origin header and atomically consumes the ticket.
- Rendering: CDP `Page.startScreencast` JPEG frames → WebSocket → `<img>`. The context emulates the user's device (phone: width 320–480, touch, mobile UA; desktop: 1280×800).
- Input: tap/click, wheel scroll, text (`keyboard.insertText`, ≤ 500 chars per message), and an allowlist of keys (Enter, Backspace, Tab, Escape, arrows, Delete). A hidden input in the SPA opens the phone keyboard. Input is never logged.
- Guard: top-level navigations (main frame and popups) are allowed only to LinkedIn/Naukri, their CDNs, Google sign-in and captcha providers; others are aborted. Downloads off, no permissions. Popups (e.g. Google SSO) take over the stream until closed.
- Limits: `MAX_LOGIN_SESSIONS` (default 3) concurrent; 5 min idle and 15 min absolute timeout.
- Success detection: LinkedIn `li_at` cookie or `/feed`; Naukri `nauk_at`/`nauk_rt` cookie or `/mnjuser/`. Then `storageState` is AES-256-GCM encrypted into `portal_connections` and the window closes. Passwords are never seen or stored by the platform.

## Data

- `portal_connections`: `{user_id, portal: linkedin|naukri, status: connected|expired, storage_state (encrypted), connected_at, last_checked_at, last_crawl_at, last_error}`, unique per user + portal.
- `login_tickets`: `{token_hash, user_id, portal, viewport, expires_at (TTL), used_at}`.
- `User.portals`: `{crawl_enabled: true, naukri_profile_refresh: false, last_naukri_refresh_at}`.
- `JobPosting.source` adds `linkedin`, `naukri`. Run kinds add `portal_crawl`, `naukri_refresh`.

## Worker

- `portal_crawl` (cron `30 */3 * * *` IST for users with a connected portal, crawling enabled, AI ready and target roles; daily cap 10; "Search portals now" button):
  - Per connected portal: check the session (login/authwall/checkpoint URL → mark `expired`, continue with the other portal).
  - Collect job links from the recommended page and up to 2 searches (target role × first target city, newest, last 7 days), scrolling a few times.
  - Open up to 20 job pages per portal with 2.5–5 s random delays; extract with JSON-LD → selectors → title/meta fallbacks.
  - Same filters, dedupe, scoring and sheet sync as the web crawl (shared ingest code).
  - Save the refreshed `storageState` after a successful crawl.
- `naukri_refresh` (cron `15 9 * * *` IST when enabled; daily cap 2): upload the current resume on the Naukri profile page and confirm success text.

## API and UI

- `GET /api/portals`, `POST /api/portals/:portal/connect`, `DELETE /api/portals/:portal`, `PUT /api/portals/settings`, `POST /api/portals/naukri/refresh`, `POST /api/runs/portal-crawl`.
- Settings → **Job portals** card: status per portal, Connect/Reconnect/Disconnect, toggles, "Search portals now", account-safety note. Full-screen login window works on phones. Jobs show LinkedIn/Naukri as the source.

## Deployment

New `browser` image/service (internal, `shm_size: 1gb`); Caddy routes `/api/portals/ws*` to it; CI builds it.
