const fs = require("fs");
const path = require("path");
const { llmJson } = require("./llm");
const { atsCoverage } = require("./ats");
const { verifyTailoredResume, resumeToText } = require("./tailor-guard");

function loadBaseResumes(candidate, resumeDir) {
  if (!resumeDir || !fs.existsSync(resumeDir)) return [];
  const listed = candidate.tailor_base_resumes || [];
  const names = listed.length
    ? listed
    : fs.readdirSync(resumeDir).filter((n) => /resume/i.test(n) && n.toLowerCase().endsWith(".md"));
  return names
    .map((name) => path.join(resumeDir, name))
    .filter((full) => fs.existsSync(full))
    .map((full) => ({ name: path.basename(full), text: fs.readFileSync(full, "utf8") }));
}

function pickBaseResume(bases, keywords) {
  let best = null;
  for (const base of bases) {
    const score = atsCoverage(keywords, base.text).score ?? 0;
    if (!best || score > best.score) best = { ...base, score };
  }
  return best;
}

function tailorPrompt({ base, job, missing }) {
  return `Rewrite this resume so it passes an ATS screen for the job below, WITHOUT inventing anything.

Hard rules (violations make the output unusable):
- Keep every employer, job title, location and date range exactly as written in the base resume.
- Do not add tools, systems, certifications, metrics, numbers, degrees or responsibilities that the base resume does not support.
- You MAY: rephrase bullets with the job's terminology when the base resume describes the same work (e.g. "customer POs" -> "purchase orders (POs)"), reorder bullets and skills by relevance, rewrite the headline and summary toward this role, and add a skill keyword only when the base resume already evidences it.
- Keyword gaps to cover ONLY where truthful: ${missing.join(", ") || "none"}.
- Keep it to one page: summary <= 70 words, <= 3 highlights, <= 4 bullets per role.

Return a JSON object:
{"name":"","contact_line":"phone | email | city | linkedin","headline":"","summary":"","highlights":[""],"skills":[{"label":"","items":[""]}],"experience":[{"company":"","location":"","title":"","dates":"","bullets":[""]}],"education":[""],"extras":[""]}

Job: ${job.job_title} at ${job.company}
Job description:
${String(job.description || "").slice(0, 5000)}

Base resume:
${base.text}`;
}

async function tailorResume({ candidate, resumeDir, job, runId }) {
  const bases = loadBaseResumes(candidate, resumeDir);
  if (!bases.length) throw new Error(`No base resume (.md) found in ${resumeDir}`);
  const keywords = job.ats_keywords || [];
  const base = pickBaseResume(bases, keywords);
  const missing = atsCoverage(keywords, base.text).missing;

  let problems = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const resume = await llmJson(
      tailorPrompt({ base, job, missing }) +
        (problems.length ? `\n\nYour previous attempt was rejected: ${problems.join("; ")}. Fix these.` : ""),
      { maxTokens: 2500, runId }
    );
    problems = verifyTailoredResume(resume, base.text);
    if (!problems.length) {
      const ats = atsCoverage(keywords, resumeToText(resume));
      return { resume, base_resume: base.name, base_ats: base.score, ats_score: ats.score };
    }
  }
  throw new Error(`Tailored resume failed truth check: ${problems.join("; ")}`);
}

module.exports = { tailorResume, loadBaseResumes, pickBaseResume };
