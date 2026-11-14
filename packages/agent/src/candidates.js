const fs = require("fs");
const path = require("path");
const { Candidate, ResumeProfile } = require("@jobportal/db");
const { parseResume } = require("@jobportal/core");

const ANIKA_PROFILE = {
  target_roles: [
    "operations analyst",
    "supply chain analyst",
    "logistics analyst",
    "warehouse operations",
    "operations executive",
    "inventory analyst",
    "fleet management",
    "line haul",
    "quick commerce",
    "transshipment",
    "loss prevention analyst",
    "procurement analyst",
    "procurement executive",
    "purchase executive",
    "supply chain executive",
  ],
  skills: [
    "excel",
    "sql",
    "supply chain",
    "logistics",
    "warehouse",
    "inventory",
    "kpi",
    "sla",
    "vendor management",
    "fleet management",
    "line haul",
    "data analysis",
    "dashboard",
    "operations",
    "quick commerce",
    "transshipment",
    "shrinkage",
    "root cause analysis",
  ],
  locations: ["bangalore", "bengaluru", "karnataka", "india"],
  experience_years: 2,
  job_keywords: [
    "supply chain",
    "line haul",
    "fleet management",
    "quick commerce",
    "operations analyst",
    "logistics analyst",
    "warehouse operations",
    "transshipment",
    "inventory analyst",
    "vendor management",
    "loss prevention",
    "supply chain analyst bangalore",
  ],
  search_queries: [
    "supply chain opening",
    "line haul opening",
    "fleet management opening",
    "quick commerce opening",
  ],
};

const ANIKA_CAREER_PAGES = [
  { name: "Razorpay", url: "https://boards.greenhouse.io/razorpaysoftwareprivatelimited" },
  { name: "Groww", url: "https://job-boards.greenhouse.io/groww" },
  { name: "Meesho", url: "https://jobs.lever.co/meesho" },
  { name: "Porter", url: "https://jobs.lever.co/porter" },
  { name: "CRED", url: "https://jobs.lever.co/cred" },
  { name: "Swiggy", url: "https://careers.swiggy.com/#/careers" },
  { name: "Flipkart", url: "https://www.flipkartcareers.com/#!/joblist" },
  { name: "Delhivery", url: "https://www.delhivery.com/careers" },
];

const TANMOY_PROFILE = {
  target_roles: [
    "ar analyst",
    "accounts receivable analyst",
    "denial management",
    "rcm analyst",
    "rcm specialist",
    "medical billing analyst",
    "claims analyst",
  ],
  skills: [
    "accounts receivable",
    "denial management",
    "claim appeals",
    "revenue cycle",
    "rcm",
    "excel",
    "hipaa",
    "payer coordination",
    "a/r aging",
    "medical billing",
    "root cause analysis",
    "documentation",
  ],
  locations: ["kolkata", "remote", "india", "bangalore", "bengaluru", "hyderabad"],
  experience_years: 3,
  job_keywords: [
    "AR analyst",
    "denial management",
    "RCM analyst",
    "accounts receivable",
    "claims analyst",
    "medical billing",
    "revenue cycle",
  ],
  search_queries: [
    "AR analyst",
    "denial management",
    "RCM specialist",
    "accounts receivable analyst",
  ],
};

function dataDir() {
  const envState = process.env.NAUKRI_STORAGE_STATE || "./data/naukri-storage-state.json";
  return process.env.DATA_DIR || path.dirname(path.resolve(envState));
}

function resumeRoot() {
  return process.env.RESUME_ROOT || process.env.RESUME_DIR || "/app/resume";
}

function isIgnoredResumeName(name) {
  return /(cover.?letter|references|notes|generate_)/i.test(name);
}

function mimeForResume(filename) {
  const ext = path.extname(filename || "").toLowerCase();
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".docx") {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (ext === ".md") return "text/markdown";
  if (ext === ".txt") return "text/plain";
  return "application/octet-stream";
}

function listResumeFiles(resumeDir, { uploadable = false } = {}) {
  if (!resumeDir || !fs.existsSync(resumeDir)) return [];
  return fs
    .readdirSync(resumeDir)
    .filter((name) => {
      if (name.startsWith(".")) return false;
      if (isIgnoredResumeName(name)) return false;
      const lower = name.toLowerCase();
      if (uploadable) return /\.(pdf|docx)$/.test(lower);
      return /\.(pdf|docx|md|txt)$/.test(lower);
    })
    .map((name) => {
      const full = path.join(resumeDir, name);
      const stat = fs.statSync(full);
      const lower = name.toLowerCase();
      let score = stat.mtimeMs;
      if (/resume/i.test(name)) score += 1e15;
      if (lower.endsWith(".pdf")) score += 3e13;
      else if (lower.endsWith(".docx")) score += 2e13;
      else if (lower.endsWith(".md")) score += 1e13;
      return { name, full, mtimeMs: stat.mtimeMs, score };
    })
    .sort((a, b) => b.score - a.score);
}

function pickLatestResumeFile(resumeDir, { uploadable = false } = {}) {
  return listResumeFiles(resumeDir, { uploadable })[0] || null;
}

function pickLatestResumeUploadPath(resumeDir) {
  return pickLatestResumeFile(resumeDir, { uploadable: true })?.full || null;
}

function resolveResumeDir(candidate) {
  if (!candidate) return resumeRoot();
  if (candidate.resume_dir && fs.existsSync(candidate.resume_dir)) {
    return candidate.resume_dir;
  }
  const fromRoot = path.join(resumeRoot(), candidate.slug);
  if (fs.existsSync(fromRoot)) return fromRoot;
  const local = path.resolve(__dirname, "../../../../", `${candidate.slug}-resume`);
  if (fs.existsSync(local)) return local;
  return candidate.resume_dir || resumeRoot();
}

function resolveNaukriStoragePath(candidate) {
  if (!candidate?.naukri_storage_state) {
    return process.env.NAUKRI_STORAGE_STATE || path.join(dataDir(), "naukri-storage-state.json");
  }
  if (path.isAbsolute(candidate.naukri_storage_state)) {
    return candidate.naukri_storage_state;
  }
  return path.join(dataDir(), candidate.naukri_storage_state);
}

function migrateLegacyNaukriSession(slug) {
  const dest = path.join(dataDir(), "sessions", `${slug}-naukri.json`);
  const legacy = process.env.NAUKRI_STORAGE_STATE || path.join(dataDir(), "naukri-storage-state.json");
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (slug === "anika" && fs.existsSync(legacy) && !fs.existsSync(dest)) {
      fs.copyFileSync(legacy, dest);
    }
  } catch {
    /* ignore copy errors */
  }
  return path.join("sessions", `${slug}-naukri.json`);
}

const SEED = [
  {
    slug: "anika",
    name: "Anika Bhattacharyya",
    resume_dir: path.join(resumeRoot(), "anika"),
    profile: ANIKA_PROFILE,
    apply_prefs: {
      notice_period: "30 days",
      current_ctc: "",
      expected_ctc: "",
      locations: "Bengaluru / Bangalore",
    },
    tailor_base_resumes: [
      "Anika_Bhattacharyya_Resume_Procurement_Operations.md",
      "Anika_Bhattacharyya_Resume_SupplyChain_Operations_Analyst.md",
    ],
    career_pages: ANIKA_CAREER_PAGES,
    is_active: true,
  },
  {
    slug: "tanmoy",
    name: "Tanmoy Paul",
    resume_dir: path.join(resumeRoot(), "tanmoy"),
    profile: TANMOY_PROFILE,
    apply_prefs: {
      notice_period: "30 days",
      current_ctc: "",
      expected_ctc: "",
      locations: "Kolkata / Remote / Relocate",
    },
    is_active: false,
  },
];

async function seedLatestResume(candidate) {
  const dir = resolveResumeDir(candidate);
  const picked = pickLatestResumeFile(dir);
  if (!picked) {
    console.warn(`[seed] No resume file found for ${candidate.slug} in ${dir}`);
    return null;
  }

  const buffer = fs.readFileSync(picked.full);
  const text = await parseResume(buffer, picked.name);
  const filename = picked.name;

  const existing = await ResumeProfile.findOne({
    candidate_id: candidate._id,
    filename,
  }).sort("-uploaded_at");

  const makeActive = Boolean(candidate.is_active);
  if (makeActive) {
    await ResumeProfile.updateMany({}, { $set: { is_active: false } });
  } else {
    await ResumeProfile.updateMany({ candidate_id: candidate._id }, { $set: { is_active: false } });
  }

  if (existing && existing.text === text) {
    existing.is_active = makeActive;
    existing.candidate_id = candidate._id;
    await existing.save();
    if (String(candidate.resume_id || "") !== String(existing._id)) {
      candidate.resume_id = existing._id;
      await candidate.save();
    }
    console.log(`[seed] Reused resume for ${candidate.slug}: ${filename}`);
    return existing;
  }

  const doc = await ResumeProfile.create({
    filename,
    mime_type: mimeForResume(filename),
    text,
    is_active: makeActive,
    candidate_id: candidate._id,
    uploaded_at: new Date(picked.mtimeMs),
  });
  candidate.resume_id = doc._id;
  await candidate.save();
  console.log(`[seed] Loaded latest resume for ${candidate.slug}: ${filename} (${text.length} chars)`);
  return doc;
}

async function seedCandidates() {
  for (const item of SEED) {
    const storageRel = migrateLegacyNaukriSession(item.slug);
    let candidate = await Candidate.findOne({ slug: item.slug });
    if (candidate) {
      candidate.resume_dir = item.resume_dir;
      candidate.name = item.name;
      if (!candidate.naukri_storage_state) candidate.naukri_storage_state = storageRel;
      if (!candidate.profile?.target_roles?.length) {
        candidate.profile = item.profile;
      } else {
        const roles = new Set(candidate.profile.target_roles.map((r) => r.toLowerCase()));
        const added = item.profile.target_roles.filter((r) => !roles.has(r.toLowerCase()));
        if (added.length) candidate.profile.target_roles.push(...added);
      }
      if (!candidate.apply_prefs?.notice_period) candidate.apply_prefs = item.apply_prefs;
      if (!candidate.tailor_base_resumes?.length && item.tailor_base_resumes) {
        candidate.tailor_base_resumes = item.tailor_base_resumes;
      }
      if (!candidate.career_pages?.length && item.career_pages) {
        candidate.career_pages = item.career_pages;
      }
      await candidate.save();
    } else {
      candidate = await Candidate.create({
        ...item,
        naukri_storage_state: storageRel,
        max_apply_per_day: 20,
        ai_min_score: 70,
      });
    }
    await seedLatestResume(candidate);
  }

  const active = await Candidate.findOne({ is_active: true });
  if (!active) {
    await Candidate.updateOne({ slug: "anika" }, { $set: { is_active: true } });
  }

  const current = await Candidate.findOne({ is_active: true });
  if (current?.resume_id) {
    await ResumeProfile.updateMany({}, { $set: { is_active: false } });
    await ResumeProfile.updateOne({ _id: current.resume_id }, { $set: { is_active: true } });
  }
}

async function getActiveCandidate() {
  let candidate = await Candidate.findOne({ is_active: true });
  if (!candidate) {
    await seedCandidates();
    candidate = await Candidate.findOne({ is_active: true });
  }
  return candidate;
}

async function setActiveCandidate(idOrSlug) {
  const query = mongooseId(idOrSlug)
    ? { _id: idOrSlug }
    : { slug: idOrSlug };
  const next = await Candidate.findOne(query);
  if (!next) throw new Error("Candidate not found");
  await Candidate.updateMany({}, { $set: { is_active: false } });
  next.is_active = true;
  await next.save();
  return next;
}

function mongooseId(value) {
  return typeof value === "string" && /^[a-f0-9]{24}$/i.test(value);
}

function candidateToProfile(candidate) {
  const p = candidate?.profile || {};
  return {
    name: candidate?.name,
    target_roles: p.target_roles || [],
    skills: p.skills || [],
    locations: p.locations || [],
    experience_years: p.experience_years || 0,
    job_keywords: p.job_keywords || [],
    search_queries: p.search_queries || [],
  };
}

module.exports = {
  seedCandidates,
  seedLatestResume,
  getActiveCandidate,
  setActiveCandidate,
  resolveResumeDir,
  resolveNaukriStoragePath,
  pickLatestResumeFile,
  pickLatestResumeUploadPath,
  candidateToProfile,
  ANIKA_PROFILE,
  TANMOY_PROFILE,
};
