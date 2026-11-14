const { llmJson } = require("./llm");
const { atsCoverage } = require("./ats");

const RELEVANCY = ["High", "Medium", "Low"];

function scorePrompt({ job, resumeText, profile }) {
  return `You screen jobs for a candidate. Compare the job to the resume and return a JSON object:
{"fit":0-100,"relevancy":"High|Medium|Low","summary":"2-3 sentences: what the role does, key requirements, why it fits or not","keywords":["up to 20 ATS keywords from the job description: hard skills, tools, domain terms, certifications, exact role phrases"]}

Scoring rules:
- "fit" is how well the candidate's ACTUAL experience matches the role (domain, responsibilities, seniority, location), not keyword overlap.
- Penalise heavily: seniority far above/below ~${profile.experience_years || 2} years, unrelated function, location outside Bengaluru.
- "keywords" must be copied from the job text in their original wording (e.g. "SAP Ariba", "Purchase Orders", "Vendor Management").

Candidate target roles: ${(profile.target_roles || []).join(", ")}

Resume:
${String(resumeText || "").slice(0, 6000)}

Job:
Title: ${job.job_title || ""}
Company: ${job.company || ""}
Location: ${job.location || ""}
Experience: ${job.experience_level || ""}
Description:
${String(job.description || "").slice(0, 5000)}`;
}

async function scoreJob({ job, resumeText, profile, runId }) {
  const parsed = await llmJson(scorePrompt({ job, resumeText, profile }), { maxTokens: 700, runId });
  const fit = Math.max(0, Math.min(100, Math.round(Number(parsed.fit) || 0)));
  const keywords = (Array.isArray(parsed.keywords) ? parsed.keywords : [])
    .map((k) => String(k).trim())
    .filter(Boolean)
    .slice(0, 20);
  const ats = atsCoverage(keywords, resumeText);
  return {
    fit_score: fit,
    relevancy: RELEVANCY.includes(parsed.relevancy) ? parsed.relevancy : fit >= 75 ? "High" : fit >= 50 ? "Medium" : "Low",
    summary: String(parsed.summary || "").trim().slice(0, 600),
    ats_keywords: keywords,
    ats_missing: ats.missing,
    ats_score: ats.score,
  };
}

module.exports = { scoreJob };
