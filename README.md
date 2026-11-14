# Job Crawler

A multi-user AI job crawler. People sign up (email + password or Google), upload a resume, and get matching jobs from any site, newest first, scored against their resume. Tailored, ATS-friendly resumes are generated only when the user clicks **Generate resume** on a job.

- **Resume → profile:** the PDF/DOCX text is extracted; AI turns it into target roles, skills, experience and cities (all editable).
- **Crawling:** every hour (opt-in) or on demand. Each run:
  1. **Plans keywords:** the AI turns the profile into ~24 job and ~8 company search keywords, re-planned when the profile changes. Keywords that find good jobs are favoured; ones that keep finding nothing are retired. Users can add or retire keywords.
  2. **Searches the web:** one small AI search per keyword (search results only, no page opening). Then our own fetcher reads each job page for its description and drops dead links.
  3. **Discovers companies (daily):** AI search suggests companies likely to hire the candidate (up to 40). Their careers page is found and verified without AI, from the homepage links (rendered in the browser if needed) or common paths, and then added automatically.
  4. **Crawls career pages:** the 10 stalest target companies per run. Greenhouse, Lever, Ashby, Workday and SmartRecruiters are read through their JSON APIs; other sites through the browser; one AI `site:` search is the capped fallback.
- **Agent memory:** Activity → Memory shows companies (AI-found or yours, with results per page), keywords with their yield, and every visited page. Pages are remembered for 90 days so known jobs are not re-read and failing sites are backed off.
- **Token usage:** every AI call is metered (input, output, cached tokens, estimated list-price cost). Settings → AI usage shows today vs the daily budget (default 1.5M tokens), the last 7 days, and usage by step, model and run. Before each call the worker checks it fits the budget, and searches always leave 15% for scoring. Once the budget is used up, AI steps pause until midnight IST while the free crawls (career APIs, browser) continue. A typical run uses ~200k tokens.
- **Scoring:** match %, relevancy, a short summary, ATS % and missing keywords per job.
- **Bring your own AI:** each user saves a Cursor and/or OpenAI key (encrypted at rest) and picks the provider + model that does all the work.
- **Google Drive (optional):** a per-user "Job Matches" sheet (newest first) and a folder of generated resume PDFs.
- **LinkedIn / Naukri (optional):** users sign in through a private in-app login window; the platform then crawls each portal's recommended jobs and a logged-in search every 3 hours. Optional daily Naukri profile refresh. No auto-apply.
- **Live activity:** the Activity page streams every background step as it happens (Server-Sent Events from `/api/runs/live`): AI calls with provider, model and duration, the search agent's narration and queries, each job found, opened and scored. Filter by AI, Jobs or Problems; the Jobs page banner shows the latest line.
- **Admin:** users with emails in `ADMIN_EMAILS` can see usage, disable accounts and issue one-time password resets.

## Layout

```
apps/api       Express API (auth, profile, resume, jobs, runs, settings, Google, admin)
apps/worker    Run queue: resume parsing, web + portal crawling, resume generation, Naukri refresh, scheduler
apps/browser   Private login windows for LinkedIn/Naukri (streamed headless Chromium over WebSocket)
apps/web       React SPA (mobile-first), served by Caddy in Docker
packages/portals Portal login/session helpers, URL builders, navigation allowlist, login tickets
packages/db    Mongoose models + run queue helpers
packages/ai    Cursor / OpenAI providers, key encryption
packages/google Google sign-in, Drive and Sheets
packages/core  Resume text extraction, date helpers
deploy/        Caddyfile, backup script
```

## Run locally (Docker)

```bash
cp .env.example .env
# fill in SESSION_SECRET (openssl rand -hex 32), APP_ENCRYPTION_KEY (openssl rand -base64 32), ADMIN_EMAILS
docker compose up -d --build
```

Open http://localhost:3006, create an account, and follow the 4-step setup (resume → AI key → profile → start).

Keep `APP_ENCRYPTION_KEY` safe and stable: if it changes, stored AI keys and Google tokens can no longer be decrypted and users must re-enter them.

### Without Docker

Needs Node 22.13+ and MongoDB on `localhost:27017`.

```bash
npm install
npm run dev:api      # :4000
npm run dev:worker
npm run dev:browser  # :5100, login windows
npm run dev:web      # :3006, proxies /api to :4000 and /api/portals/ws to :5100
npm test             # unit + API integration tests (uses mongodb://localhost:27017/jobcrawler_test)
```

## LinkedIn and Naukri connections

**Settings → Job portals → Connect** opens a full-screen login window. It is a fresh, isolated headless Chromium context on the server (`browser` service), streamed to the user as JPEG frames over an authenticated WebSocket; taps and typing are sent back. It works on phones (the window emulates the user's screen).

- Access needs a single-use ticket (60 s) issued to the signed-in user; the WebSocket also checks the Origin header. The `browser` service has no public port; Caddy routes `/api/portals/ws` to it.
- Navigation is limited to LinkedIn/Naukri, their CDNs, Google/Apple sign-in and captcha providers. Windows close after 5 idle minutes (15 minutes max); `MAX_LOGIN_SESSIONS` (default 3) run at once.
- When the login cookie appears, the browser storage state is encrypted (AES-256-GCM with `APP_ENCRYPTION_KEY`) into `portal_connections`. Passwords are never stored.
- The worker crawls with that session every 3 hours at :30 (recommended jobs + 2 searches, up to 20 job pages per portal, 2.5–5 s between pages), refreshes the stored session, and marks it **expired** when the portal asks to sign in again.
- **Refresh my Naukri profile daily** re-uploads the current resume at 09:15 IST.

Portals can restrict accounts that look automated. Keep the limits conservative and connect personal accounts only.

## Google sign-in and Drive (optional)

1. [Google Cloud Console](https://console.cloud.google.com/) → new project → enable **Google Drive API** and **Google Sheets API**.
2. **OAuth consent screen:** External. Scopes: `openid`, `email`, `profile`, `.../auth/drive.file`. Publish the app (these are non-sensitive scopes, so no verification is needed, and published apps avoid the 7-day refresh-token expiry of test apps).
3. **Credentials → OAuth client ID → Web application.** Authorized redirect URIs (use your real domain in production):
   - `http://localhost:3006/api/auth/google/callback`
   - `http://localhost:3006/api/google/drive/callback`
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` and restart. "Continue with Google" appears on the sign-in page and "Connect Google Drive" in Settings.

## Deploy to a VPS (GitHub Actions)

Production runs at **https://job-crawler.educoreva.com** behind the shared edge nginx from the `hosting` repo, which owns ports 80/443 and routes `job-crawler.educoreva.com` → `job-crawler-web:80` (`hosting/nginx/conf.d/job-crawler.conf`). Only the `web` container joins the shared Docker network `web`; the API, worker, login browser and MongoDB stay private.

```
Internet → Cloudflare → VPS edge-nginx (hosting) → job-crawler-web (Caddy: SPA, /api → api, /api/portals/ws → browser)
```

Pushing to `master` runs `.github/workflows/deploy.yml`:
1. Tests run.
2. The `api`, `worker`, `browser` and `web` images are built and pushed to GHCR.
3. `deploy/ship.sh` connects to the VPS over SSH, with the host key pinned, and uploads the compose file and scripts.
4. `deploy/remote-deploy.sh` runs on the VPS: it pulls the images, restarts the stack, and waits for `api`, `browser` and `web` to report healthy. If they don't, it rolls back to the previous images.
5. The workflow checks `https://job-crawler.educoreva.com/api/health`.

The first deploy creates `~/job-crawler/.env` on the VPS. It generates `SESSION_SECRET`, `APP_ENCRYPTION_KEY` and the MongoDB credentials on the server, so they never pass through GitHub. **Back that file up:** if `APP_ENCRYPTION_KEY` is lost, stored AI keys can't be decrypted, and the MongoDB password can't change once the database exists. Later deploys keep these values. They only update the values GitHub manages: `PUBLIC_URL`, `IMAGE_PREFIX`, `IMAGE_TAG`, and `ADMIN_EMAILS`/`GOOGLE_*` when set.

### One-time setup

1. **Hosting router:** deploy the `hosting` repo (it includes the `job-crawler.educoreva.com` route). Its `edge-nginx` creates the Docker network `web`; this deploy refuses to run without it.
2. **VPS user:** the SSH user (e.g. `deploy`, the same one hosting uses) must be in the `docker` group. The VPS needs Docker Engine with the compose plugin, `openssl` and `flock` (standard on Ubuntu/Debian).
3. **DNS:** in Cloudflare, add a proxied `A` record for `job-crawler` in `educoreva.com` pointing to the VPS IP. Like `icds.educoreva.com`, it runs in Flexible mode: Cloudflare serves HTTPS to visitors, and the origin speaks HTTP.
4. **Google sign-in (optional):** add these redirect URIs to the OAuth client: `https://job-crawler.educoreva.com/api/auth/google/callback` and `https://job-crawler.educoreva.com/api/google/drive/callback`.

### GitHub repository settings

Settings → Secrets and variables → Actions. The SSH values can be the same ones the `hosting` repo uses.

| Kind | Name | Value |
|------|------|-------|
| Secret | `PROD_SSH_HOST` | VPS IP, e.g. `89.117.56.119` |
| Secret | `PROD_SSH_USER` | SSH user, e.g. `deploy` |
| Secret | `PROD_SSH_PRIVATE_KEY` | Private key for that user (its public key in `~/.ssh/authorized_keys` on the VPS) |
| Secret | `PROD_SSH_PASSPHRASE` | Key passphrase, if the key is encrypted |
| Variable | `PROD_SSH_KNOWN_HOSTS` | The VPS host key line(s) for `known_hosts`, verified out of band (e.g. `ssh-keyscan -H <ip>` checked against the provider console fingerprint) |
| Variable (optional) | `PROD_SSH_PORT` | SSH port, default `22` |
| Variable (optional) | `DEPLOY_DIR` | App directory on the VPS, default `$HOME/job-crawler` |
| Variable (optional) | `PUBLIC_URL` | Default `https://job-crawler.educoreva.com` |
| Variable (optional) | `ADMIN_EMAILS` | Comma-separated admin emails |
| Variable / Secret (optional) | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google sign-in + Drive |
| Variable (optional) | `VPS_PLATFORM` | `linux/amd64` (default) or `linux/arm64` |

The deploy job uses the `production` environment (created automatically; add required reviewers there if you want manual approval). The built-in `GITHUB_TOKEN` pushes the images and lets the VPS pull them during the deploy. Deploys can also be started by hand: Actions → Deploy → Run workflow.

### Operations

```bash
cd ~/job-crawler
docker compose -f docker-compose.prod.yml ps
docker compose -f docker-compose.prod.yml logs -f worker
ls backups/                                   # nightly mongodump archives, kept 14 days
docker compose -f docker-compose.prod.yml exec -T backup \
  mongorestore --uri "$MONGO_URI" --gzip --archive=/backups/<file>.archive.gz --drop
```

## Migrating data from the old Naukri/LinkedIn crawler

The old VNC/Naukri version is preserved on the `legacy/naukri-vnc-snapshot` branch. To copy a legacy candidate's roles, career pages and discovered jobs into an account (sign up first, then upload the resume in the app):

```bash
docker compose exec worker node src/scripts/migrate-legacy.js --email you@example.com --slug anika --exclude Amazon
```
