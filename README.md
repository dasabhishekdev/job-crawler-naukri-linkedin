# Job Crawler

A multi-user AI job crawler. People sign up (email + password or Google), upload a resume, and get matching jobs from any site, newest first, scored against their resume. Tailored, ATS-friendly resumes are generated only when the user clicks **Generate resume** on a job.

- **Resume → profile:** the PDF/DOCX text is extracted; AI turns it into target roles, skills, experience and cities (all editable).
- **Crawling:** every hour (opt-in) or on demand. AI web search covers job boards, public LinkedIn/Naukri listings and company sites; target company career pages are read directly (Greenhouse, Lever, Ashby) or by the AI.
- **Scoring:** match %, relevancy, a short summary, ATS % and missing keywords per job.
- **Bring your own AI:** each user saves a Cursor and/or OpenAI key (encrypted at rest) and picks the provider + model that does all the work.
- **Google Drive (optional):** a per-user "Job Matches" sheet (newest first) and a folder of generated resume PDFs.
- **Admin:** users with emails in `ADMIN_EMAILS` can see usage, disable accounts and issue one-time password resets.

## Layout

```
apps/api       Express API (auth, profile, resume, jobs, runs, settings, Google, admin)
apps/worker    Run queue: resume parsing, crawling, resume generation, hourly scheduler
apps/web       React SPA (mobile-first), served by Caddy in Docker
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
npm run dev:web      # :3006, proxies /api to :4000
npm test             # unit + API integration tests (uses mongodb://localhost:27017/jobcrawler_test)
```

## Google sign-in and Drive (optional)

1. [Google Cloud Console](https://console.cloud.google.com/) → new project → enable **Google Drive API** and **Google Sheets API**.
2. **OAuth consent screen:** External. Scopes: `openid`, `email`, `profile`, `.../auth/drive.file`. Publish the app (these are non-sensitive scopes, so no verification is needed, and published apps avoid the 7-day refresh-token expiry of test apps).
3. **Credentials → OAuth client ID → Web application.** Authorized redirect URIs (use your real domain in production):
   - `http://localhost:3006/api/auth/google/callback`
   - `http://localhost:3006/api/google/drive/callback`
4. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `.env` and restart. "Continue with Google" appears on the sign-in page and "Connect Google Drive" in Settings.

## Deploy to a VPS (GitHub Actions)

Pushing to `main` runs `.github/workflows/deploy.yml`: tests → build `api`, `worker`, `web` images → push to GHCR → SSH into the VPS → `docker compose pull && up -d` → wait for the API health check.

### One-time server setup

```bash
# On the VPS (Ubuntu/Debian with Docker Engine + compose plugin installed)
sudo mkdir -p /opt/job-crawler && sudo chown $USER /opt/job-crawler
cd /opt/job-crawler
# create .env from .env.example and fill the production section:
#   PUBLIC_URL=https://jobs.example.com      SITE_ADDRESS=jobs.example.com
#   IMAGE_PREFIX=ghcr.io/<github-user>/job-crawler
#   MONGO_ROOT_USER=jobcrawler  MONGO_ROOT_PASSWORD=$(openssl rand -hex 24)
#   SESSION_SECRET, APP_ENCRYPTION_KEY, ADMIN_EMAILS, GOOGLE_* as above
```

Point your domain's DNS A/AAAA record at the server and open ports 80 and 443. Caddy obtains HTTPS certificates automatically.

### GitHub repository settings

| Kind | Name | Value |
|------|------|-------|
| Secret | `VPS_HOST` | Server IP or hostname |
| Secret | `VPS_USER` | SSH user that can run `docker` |
| Secret | `VPS_SSH_KEY` | Private key for that user (add the public key to `~/.ssh/authorized_keys`) |
| Variable (optional) | `VPS_PORT` | SSH port, default `22` |
| Variable (optional) | `VPS_PATH` | Deploy directory, default `/opt/job-crawler` |
| Variable (optional) | `VPS_PLATFORM` | `linux/amd64` (default) or `linux/arm64` |

Create a `production` environment under **Settings → Environments** (optionally with required reviewers). The workflow uses the built-in `GITHUB_TOKEN` to push and pull images.

### Operations

```bash
cd /opt/job-crawler
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
