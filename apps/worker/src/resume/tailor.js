const { atsCoverage } = require("../crawl/ats");
const { verifyTailoredResume, resumeToText } = require("./tailor-guard");
const { RESUME_SHAPE } = require("./parse");

function tailorPrompt({ resumeText, structured, job, missing }) {
  return `Rewrite this resume so it passes an ATS screen for the job below, WITHOUT inventing anything.

Hard rules (violations make the output unusable):
- Keep every employer, job title, location and date range exactly as written in the original resume.
- Do not add tools, systems, certifications, metrics, numbers, degrees or responsibilities the original resume does not support.
- You MAY rephrase bullets with the job's terminology when the original describes the same work, reorder bullets and skills by relevance, rewrite the headline and summary toward this role, and add a skill keyword only when the original already evidences it.
- Keyword gaps to cover ONLY where truthful: ${missing.join(", ") || "none"}.
- Keep it to one page: summary <= 70 words, <= 3 highlights, <= 4 bullets per role.

Return a JSON object: ${RESUME_SHAPE}

Job: ${job.title} at ${job.company}
Job description:
${String(job.description || "").slice(0, 5000)}

Original resume (source of truth):
${resumeText}
${structured ? `\nStructured version of the same resume:\n${JSON.stringify(structured).slice(0, 8000)}` : ""}`;
}

async function tailorResume({ ai, resumeText, structured, job }) {
  const keywords = job.match?.keywords || [];
  const before = atsCoverage(keywords, resumeText);
  let problems = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const resume = await ai.json(
      tailorPrompt({ resumeText, structured, job, missing: before.missing }) +
        (problems.length ? `\n\nYour previous attempt was rejected: ${problems.join("; ")}. Fix these.` : ""),
      { maxTokens: 2500, label: attempt ? "Rewriting the resume after a truth-check failure" : `Writing your resume for ${job.title}` }
    );
    problems = verifyTailoredResume(resume, resumeText);
    if (!problems.length) {
      return { resume, ats_before: before.score, ats_after: atsCoverage(keywords, resumeToText(resume)).score };
    }
  }
  throw new Error(`The generated resume failed the truth check: ${problems.join("; ")}`);
}

module.exports = { tailorResume };
