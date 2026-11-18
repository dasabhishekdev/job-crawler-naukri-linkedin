const { atsCoverage } = require("./ats");
const { enqueueEligibleApplications } = require("../apply/enqueue");

const RELEVANCY = ["High", "Medium", "Low"];
const BATCH_SIZE = { cursor: 5, openai: 1 };
const CONCURRENCY = { cursor: 3, openai: 4 };

function jobBlock(job) {
  return `### id: ${job._id}
Title: ${job.title}
Company: ${job.company}
Location: ${job.location || ""}
Experience: ${job.experience || ""}
Description:
${String(job.description || "").slice(0, 3500)}`;
}

function scorePrompt({ jobs, resumeText, profile }) {
  return `You screen jobs for a candidate. For EACH job below, compare it to the resume.

Return a JSON object: {"results":[{"id":"<job id>","fit":0-100,"relevancy":"High|Medium|Low","summary":"2-3 sentences: what the role does, key requirements, why it fits or not","keywords":["up to 20 ATS keywords copied from the job description in their original wording: hard skills, tools, domain terms, certifications, role phrases"]}]}

Scoring rules:
- "fit" measures how well the candidate's ACTUAL experience matches the role (function, responsibilities, seniority, location), not keyword overlap.
- Penalise heavily: seniority far from ~${profile.experience_years || 0} years, unrelated function, location outside ${(profile.target_locations || []).join(", ") || "the candidate's city"}${profile.remote_ok ? " (remote is fine)" : ""}.

Candidate target roles: ${(profile.target_roles || []).join(", ")}

Resume:
${String(resumeText || "").slice(0, 6000)}

Jobs:
${jobs.map(jobBlock).join("\n\n")}`;
}

function toMatch(result, resumeText) {
  const fit = Math.max(0, Math.min(100, Math.round(Number(result?.fit) || 0)));
  const keywords = (Array.isArray(result?.keywords) ? result.keywords : []).map((k) => String(k).trim()).filter(Boolean).slice(0, 20);
  const ats = atsCoverage(keywords, resumeText);
  return {
    score: fit,
    relevancy: RELEVANCY.includes(result?.relevancy) ? result.relevancy : fit >= 75 ? "High" : fit >= 50 ? "Medium" : "Low",
    summary: String(result?.summary || "").trim().slice(0, 600),
    keywords,
    ats_score: ats.score,
    missing: ats.missing,
    scored_at: new Date(),
    error: "",
  };
}

async function mapLimit(items, limit, fn) {
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/** Scores jobs in provider-sized batches and saves `match` on each. Returns the number scored. */
async function scoreJobs({ ai, jobs, resumeText, profile, log, checkCancel }) {
  const size = BATCH_SIZE[ai.provider] || 1;
  const batches = [];
  for (let i = 0; i < jobs.length; i += size) batches.push(jobs.slice(i, i + size));

  let scored = 0;
  await mapLimit(batches, CONCURRENCY[ai.provider] || 2, async (batch) => {
    await checkCancel();
    try {
      const reply = await ai.json(scorePrompt({ jobs: batch, resumeText, profile }), { maxTokens: 700 * batch.length, label: `Scoring jobs: ${batch.length}` });
      const results = Array.isArray(reply.results) ? reply.results : [reply];
      for (const job of batch) {
        const result = results.find((r) => String(r.id) === String(job._id)) || (batch.length === 1 ? results[0] : null);
        if (!result) continue;
        job.match = toMatch(result, resumeText);
        await job.save();
        scored++;
        await log.job(`${job.match.score}% match · ATS ${job.match.ats_score ?? "–"}% · ${job.title} at ${job.company}`);
      }
    } catch (err) {
      if (["AiKeyError", "BudgetExceededError", "RunCancelled"].includes(err.name)) throw err;
      await log.warn(`Scoring failed for ${batch.map((j) => j.title).join(", ")}: ${err.message}`);
    }
  });
  if (jobs.length) {
    try {
      const { enqueued } = await enqueueEligibleApplications({ userId: jobs[0].user_id, jobs });
      if (enqueued && log) await log.info(`Auto-apply queued ${enqueued} job(s)`);
    } catch (err) {
      if (log) await log.warn(`Auto-apply enqueue: ${err.message}`);
    }
  }
  return scored;
}

module.exports = { scoreJobs, toMatch, scorePrompt };
