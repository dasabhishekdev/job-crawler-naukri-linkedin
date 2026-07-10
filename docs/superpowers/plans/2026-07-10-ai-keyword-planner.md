# AI Keyword Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace static crawl keywords with OpenAI-generated, resume-driven, platform-specific search queries that rotate after N fresh jobs, with live query visibility in the UI.

**Architecture:** Central `KeywordPlanner` in `@jobportal/core` called by Naukri/LinkedIn crawlers. Resume uploaded via API, stored in MongoDB. CrawlRun tracks current queries and fresh-from-query counts. UI shows live queries during crawl.

**Tech Stack:** Node.js, Express, multer, openai SDK, pdf-parse, mammoth, MongoDB/Mongoose, React (Vite)

**Spec:** `docs/superpowers/specs/2026-07-10-ai-keyword-planner-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/db/src/index.js` | `ResumeProfile` schema; CrawlRun new fields |
| `packages/core/src/resume-parser.js` | Extract text from PDF/DOCX/MD/TXT |
| `packages/core/src/keyword-planner.js` | OpenAI query generation + planner state |
| `packages/core/src/index.js` | Re-export new modules |
| `apps/api/src/routes/resume.js` | Upload + active resume endpoints |
| `apps/api/src/routes/keywords.js` | Preview keywords endpoint |
| `apps/api/src/routes/crawl.js` | Accept threshold; return query fields in progress |
| `apps/api/src/index.js` | Register new routers; multer config |
| `apps/worker/src/progress.js` | Include query fields in `getRunProgress` |
| `apps/worker/src/crawlers/naukri.js` | Dynamic planner loop |
| `apps/worker/src/crawlers/linkedin-live.js` | Dynamic planner loop |
| `apps/worker/src/pipeline.js` | Load active resume; pass to crawlers |
| `apps/web/src/App.jsx` | Search Settings panel + live query display |
| `apps/web/src/api.js` | uploadResume, previewKeywords, etc. |
| `apps/web/src/styles.css` | Settings panel + query banner styles |
| `docker-compose.yml` | `OPENAI_API_KEY`, new deps env |
| `.env.example` | Document new vars |

---

### Task 1: Database — ResumeProfile + CrawlRun fields

**Files:**
- Modify: `packages/db/src/index.js`

- [ ] **Step 1: Add ResumeProfile schema**

```javascript
const resumeProfileSchema = new mongoose.Schema(
  {
    filename: { type: String, required: true },
    mime_type: String,
    text: { type: String, required: true },
    uploaded_at: { type: Date, default: Date.now },
    is_active: { type: Boolean, default: true, index: true },
  },
  { timestamps: true }
);
```

- [ ] **Step 2: Add CrawlRun fields**

```javascript
resume_id: { type: mongoose.Schema.Types.ObjectId, ref: "ResumeProfile" },
fresh_per_keyword_threshold: { type: Number, default: 5 },
naukri_current_query: String,
linkedin_current_query: String,
naukri_queries_used: { type: [String], default: [] },
linkedin_queries_used: { type: [String], default: [] },
naukri_fresh_from_query: { type: Number, default: 0 },
linkedin_fresh_from_query: { type: Number, default: 0 },
```

- [ ] **Step 3: Export model**

```javascript
const ResumeProfile = mongoose.model("ResumeProfile", resumeProfileSchema);
module.exports = { Job, CrawlRun, CrawlLog, ResumeProfile, connectDb };
```

---

### Task 2: Resume parser

**Files:**
- Create: `packages/core/src/resume-parser.js`
- Modify: `packages/core/src/index.js`

- [ ] **Step 1: Install deps at monorepo root**

```bash
cd jobportal && npm install pdf-parse mammoth --workspace=@jobportal/core
```

- [ ] **Step 2: Implement parseResume**

```javascript
const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

const MAX_CHARS = 12000;

async function parseResume(buffer, filename) {
  const ext = path.extname(filename || "").toLowerCase();
  let text = "";

  if (ext === ".pdf") {
    const data = await pdfParse(buffer);
    text = data.text || "";
  } else if (ext === ".docx") {
    const result = await mammoth.extractRawText({ buffer });
    text = result.value || "";
  } else if (ext === ".md" || ext === ".txt") {
    text = buffer.toString("utf8");
  } else {
    throw new Error(`Unsupported file type: ${ext}. Use PDF, DOCX, MD, or TXT.`);
  }

  text = text.replace(/\s+/g, " ").trim();
  if (text.length < 100) {
    throw new Error("Resume text too short — check the file is not empty or scanned-image-only.");
  }
  return text.slice(0, MAX_CHARS);
}

module.exports = { parseResume, MAX_CHARS };
```

- [ ] **Step 3: Export from index.js**

```javascript
const { parseResume, MAX_CHARS } = require("./resume-parser");
module.exports = { ..., parseResume, MAX_CHARS };
```

---

### Task 3: Keyword Planner (OpenAI)

**Files:**
- Create: `packages/core/src/keyword-planner.js`
- Modify: `packages/core/package.json` (add openai dep)
- Modify: `packages/core/src/index.js`

- [ ] **Step 1: Install openai**

```bash
npm install openai --workspace=@jobportal/core
```

- [ ] **Step 2: Implement generateNextQuery**

```javascript
const OpenAI = require("openai");

const MODEL = process.env.OPENAI_MODEL || "gpt-4o-mini";

function buildPrompt({ resumeText, platform, usedQueries, recentStats, location }) {
  const used = usedQueries.length ? usedQueries.join(", ") : "none";
  const stats = recentStats.length
    ? recentStats.map((s) => `"${s.query}": ${s.fresh} fresh`).join("; ")
    : "none yet";

  const platformHint =
    platform === "naukri"
      ? "Short 2-4 word Indian job portal search (job title style). Example: supply chain analyst"
      : "LinkedIn job search query, 3-6 words, can combine role + skill. Example: operations analyst logistics";

  return `You generate job search queries for ${platform}.

Resume excerpt:
${resumeText.slice(0, 8000)}

Location: ${location || "Bangalore, India"}
Already used queries (do NOT repeat): ${used}
Results so far: ${stats}

Generate ONE new creative search query optimized for ${platform}.
${platformHint}

Respond JSON only: {"query":"...","reasoning":"one sentence"}`;
}

async function generateNextQuery(opts) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const client = new OpenAI({ apiKey });
  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: buildPrompt(opts) }],
    response_format: { type: "json_object" },
    temperature: 0.8,
    max_tokens: 150,
  });

  const raw = response.choices[0]?.message?.content || "{}";
  const parsed = JSON.parse(raw);
  if (!parsed.query?.trim()) throw new Error("OpenAI returned empty query");
  return { query: parsed.query.trim(), reasoning: parsed.reasoning || "" };
}

function createPlanner({ resumeText, fallbackKeywords = [], location, log }) {
  const usedByPlatform = { naukri: [], linkedin: [] };
  const statsByPlatform = { naukri: [], linkedin: [] };
  let fallbackIndex = { naukri: 0, linkedin: 0 };

  async function next(platform) {
    try {
      const result = await generateNextQuery({
        resumeText,
        platform,
        usedQueries: usedByPlatform[platform],
        recentStats: statsByPlatform[platform],
        location,
      });
      usedByPlatform[platform].push(result.query);
      return result;
    } catch (err) {
      if (log) await log.warn(`AI keyword failed (${platform}): ${err.message} — using fallback`);
      const kw = fallbackKeywords[fallbackIndex[platform] % fallbackKeywords.length];
      fallbackIndex[platform] += 1;
      const query = kw || "operations analyst";
      usedByPlatform[platform].push(query);
      return { query, reasoning: "fallback keyword" };
    }
  }

  function recordFresh(platform, query, freshCount) {
    const existing = statsByPlatform[platform].find((s) => s.query === query);
    if (existing) existing.fresh = freshCount;
    else statsByPlatform[platform].push({ query, fresh: freshCount });
  }

  return { next, recordFresh, usedByPlatform };
}

module.exports = { generateNextQuery, createPlanner, MODEL };
```

- [ ] **Step 3: Export from core index**

---

### Task 4: API — resume upload + preview

**Files:**
- Create: `apps/api/src/routes/resume.js`
- Create: `apps/api/src/routes/keywords.js`
- Modify: `apps/api/src/index.js`
- Modify: `apps/api/package.json`

- [ ] **Step 1: Install multer**

```bash
npm install multer --workspace=@jobportal/api
```

- [ ] **Step 2: resume.js router**

```javascript
const express = require("express");
const multer = require("multer");
const { ResumeProfile } = require("@jobportal/db");
const { parseResume } = require("@jobportal/core");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

const router = express.Router();

router.post("/upload", upload.single("resume"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const text = await parseResume(req.file.buffer, req.file.originalname);
    await ResumeProfile.updateMany({}, { is_active: false });
    const doc = await ResumeProfile.create({
      filename: req.file.originalname,
      mime_type: req.file.mimetype,
      text,
      is_active: true,
    });
    res.json({
      message: "Resume uploaded",
      resume_id: doc._id,
      filename: doc.filename,
      text_length: text.length,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get("/active", async (_req, res) => {
  const doc = await ResumeProfile.findOne({ is_active: true }).sort("-uploaded_at").lean();
  if (!doc) return res.json({ active: false });
  res.json({
    active: true,
    resume_id: doc._id,
    filename: doc.filename,
    uploaded_at: doc.uploaded_at,
    text_length: doc.text?.length || 0,
  });
});

module.exports = router;
```

- [ ] **Step 3: keywords.js preview router**

```javascript
const express = require("express");
const { ResumeProfile } = require("@jobportal/db");
const { generateNextQuery } = require("@jobportal/core");

const router = express.Router();

router.post("/preview", async (req, res) => {
  try {
    const resume = await ResumeProfile.findOne({ is_active: true }).lean();
    if (!resume) return res.status(400).json({ error: "Upload a resume first" });

    const location = process.env.NAUKRI_LOCATION || "bengaluru";
    const [naukri, linkedin] = await Promise.all([
      generateNextQuery({ resumeText: resume.text, platform: "naukri", usedQueries: [], recentStats: [], location }),
      generateNextQuery({ resumeText: resume.text, platform: "linkedin", usedQueries: [], recentStats: [], location: "Bangalore, Karnataka, India" }),
    ]);
    res.json({ naukri, linkedin });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
```

- [ ] **Step 4: Register in index.js**

```javascript
const resumeRouter = require("./routes/resume");
const keywordsRouter = require("./routes/keywords");
app.use("/api/resume", resumeRouter);
app.use("/api/keywords", keywordsRouter);
```

---

### Task 5: API — crawl trigger + progress fields

**Files:**
- Modify: `apps/api/src/routes/crawl.js`

- [ ] **Step 1: Require active resume before crawl**

At top of `POST /trigger`, after conflict checks:

```javascript
const { ResumeProfile } = require("@jobportal/db");
const activeResume = await ResumeProfile.findOne({ is_active: true }).lean();
if (!activeResume) {
  return res.status(400).json({ error: "Upload a resume in Search Settings before crawling." });
}
const freshPerKeyword = Number(req.body.fresh_per_keyword_threshold) || 5;
```

- [ ] **Step 2: Pass fields when creating CrawlRun**

```javascript
resume_id: activeResume._id,
fresh_per_keyword_threshold: Math.min(10, Math.max(1, freshPerKeyword)),
```

- [ ] **Step 3: Extend getProgressForRun return**

```javascript
naukri_current_query: run.naukri_current_query,
linkedin_current_query: run.linkedin_current_query,
naukri_fresh_from_query: run.naukri_fresh_from_query ?? 0,
linkedin_fresh_from_query: run.linkedin_fresh_from_query ?? 0,
fresh_per_keyword_threshold: run.fresh_per_keyword_threshold ?? 5,
```

---

### Task 6: Worker — progress + pipeline resume load

**Files:**
- Modify: `apps/worker/src/progress.js`
- Modify: `apps/worker/src/pipeline.js`

- [ ] **Step 1: Mirror query fields in getRunProgress**

Add same fields as API progress response.

- [ ] **Step 2: Pipeline loads active resume**

```javascript
const { ResumeProfile } = require("@jobportal/db");

// After run created, before crawlers:
let resumeText = null;
if (run.resume_id) {
  const resume = await ResumeProfile.findById(run.resume_id).lean();
  resumeText = resume?.text;
} else {
  const active = await ResumeProfile.findOne({ is_active: true }).lean();
  resumeText = active?.text;
}
if (!resumeText) throw new Error("No resume found for this crawl run");

config.resumeText = resumeText;
config.freshPerKeyword = run.fresh_per_keyword_threshold ?? 5;
config.fallbackKeywords = config.keywords; // existing env/profile keywords
```

Pass `config` to both crawlers (already done).

---

### Task 7: Naukri crawler — dynamic planner loop

**Files:**
- Modify: `apps/worker/src/crawlers/naukri.js`

- [ ] **Step 1: Import planner**

```javascript
const { createPlanner } = require("@jobportal/core");
const { shouldStopCrawl } = require("../progress");
```

- [ ] **Step 2: Replace keyword for-loop with planner loop**

Replace `for (const keyword of config.keywords)` with:

```javascript
const planner = createPlanner({
  resumeText: config.resumeText,
  fallbackKeywords: config.fallbackKeywords || config.keywords,
  location: config.location,
  log,
});

let currentQuery = null;
let freshFromQuery = 0;
let listingsWithoutFresh = 0;
const threshold = config.freshPerKeyword ?? 5;

while (!(await shouldStopCrawl(runId, config))) {
  if (!currentQuery || freshFromQuery >= threshold) {
    const { query, reasoning } = await planner.next("naukri");
    currentQuery = query;
    freshFromQuery = 0;
    listingsWithoutFresh = 0;
    await updateCrawlProgress(runId, {
      naukri_current_query: currentQuery,
      naukri_fresh_from_query: 0,
      $push: { naukri_queries_used: currentQuery },
    });
    await log.info(`Naukri new query: "${currentQuery}" (${reasoning})`);
  }

  // discoverKeyword(page, currentQuery, ...) — pass currentQuery as keyword
  // in inner listing loop:
  //   if fresh+valid_open: freshFromQuery++, await updateCrawlProgress fresh_from_query
  //   else: listingsWithoutFresh++
  //   if listingsWithoutFresh >= 20: break inner (force rotate)

  if (freshFromQuery >= threshold) continue; // rotate
}
```

Use `updateCrawlProgress` from progress.js (add import if missing).

---

### Task 8: LinkedIn crawler — same planner pattern

**Files:**
- Modify: `apps/worker/src/crawlers/linkedin-live.js`

Mirror Task 7 for LinkedIn with `linkedin_current_query`, `linkedin_fresh_from_query`, `linkedin_queries_used`.

---

### Task 9: Web UI — Search Settings + live queries

**Files:**
- Modify: `apps/web/src/api.js`
- Modify: `apps/web/src/App.jsx`
- Modify: `apps/web/src/styles.css`

- [ ] **Step 1: api.js helpers**

```javascript
uploadResume: (file) => {
  const form = new FormData();
  form.append("resume", file);
  return fetch(`${API_URL}/api/resume/upload`, { method: "POST", body: form }).then(async (res) => {
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    return res.json();
  });
},
getActiveResume: () => request("/api/resume/active"),
previewKeywords: () => request("/api/keywords/preview", { method: "POST" }),
```

Update `triggerCrawl`:

```javascript
triggerCrawl: (source = "all", live = true, freshPerKeyword = 5) =>
  request("/api/crawl/trigger", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, live, fresh_per_keyword_threshold: freshPerKeyword }),
  }),
```

- [ ] **Step 2: SearchSettingsPanel component**

- File input / dropzone for resume
- Show active resume filename
- Number input `freshPerKeyword` (1–10, default 5)
- Preview keywords button → shows Naukri + LinkedIn sample queries
- Persist threshold in React state (passed to handleCrawl)

- [ ] **Step 3: Update LiveCrawlStats**

```jsx
<div className="live-stat">
  <span className="live-stat-label">Naukri query</span>
  <span className="live-stat-query">{progress.naukri_current_query || "—"}</span>
  <span className="live-stat-sub">
    {progress.naukri_fresh_from_query ?? 0}/{progress.fresh_per_keyword_threshold ?? 5} fresh
  </span>
</div>
// same for LinkedIn
```

- [ ] **Step 4: Block crawl without resume**

Before `handleCrawl`, check `getActiveResume()` — alert if not active.

- [ ] **Step 5: CSS for query display**

`.live-stat-query { font-size: 0.95rem; color: var(--text); font-weight: 600; }`

---

### Task 10: Docker + env

**Files:**
- Modify: `docker-compose.yml` (auth-browser, worker, api services)
- Modify: `.env.example`

- [ ] **Step 1: Add env vars**

```yaml
OPENAI_API_KEY: ${OPENAI_API_KEY}
OPENAI_MODEL: gpt-4o-mini
```

- [ ] **Step 2: Document in .env.example**

```
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini
```

User adds key locally — never commit real key.

- [ ] **Step 3: Rebuild**

```bash
docker compose up --build -d
```

---

### Task 11: Manual test checklist

- [ ] Upload PDF resume → active resume shown
- [ ] Preview keywords → Naukri and LinkedIn queries differ
- [ ] Run live crawl without resume → blocked with message
- [ ] Live crawl → UI shows rotating queries + fresh-from-query counts
- [ ] Set threshold to 2 → queries rotate faster
- [ ] Unset OPENAI_API_KEY → crawl uses fallback keywords, no crash

---

## Spec coverage checklist

| Spec requirement | Task |
|------------------|------|
| UI resume upload | 4, 9 |
| PDF/DOCX/MD/TXT | 2 |
| AI keyword generation | 3 |
| Separate platform queries | 3, 7, 8 |
| Rotate after N fresh | 7, 8, 9 |
| UI configurable threshold | 5, 9 |
| Live query visibility | 5, 6, 9 |
| Fallback on OpenAI fail | 3, 7 |
| OPENAI_API_KEY in env only | 10 |
| Block crawl without resume | 5, 9 |

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-10-ai-keyword-planner.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — implement all tasks in this session with checkpoints

Which approach?
