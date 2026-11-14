const { Job } = require("@jobportal/db");
const { chatJson } = require("./openai");

async function rankJob({ job, resumeText, profile, runId }) {
  const fallback = {
    ai_match_score: Math.min(100, Math.round((job.match_score || 0) * 8)),
    ai_match_reason: (job.match_reasons || []).slice(0, 3).join("; ") || "Keyword match only",
  };

  if (!process.env.OPENAI_API_KEY) return fallback;

  try {
    const parsed = await chatJson({
      runId,
      maxTokens: 220,
      messages: [
        {
          role: "user",
          content: `Score how well this job fits the candidate. Return JSON only:
{"score":0-100,"reason":"one short sentence","apply":true/false}

Candidate: ${profile?.name || "candidate"}
Target roles: ${(profile?.target_roles || []).join(", ")}
Skills: ${(profile?.skills || []).slice(0, 20).join(", ")}
Experience years: ${profile?.experience_years || "n/a"}

Resume excerpt:
${(resumeText || "").slice(0, 5000)}

Job:
Title: ${job.job_title || ""}
Company: ${job.company || ""}
Location: ${job.location || ""}
Description:
${(job.description || "").slice(0, 4000)}`,
        },
      ],
    });

    const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
    return {
      ai_match_score: score,
      ai_match_reason: String(parsed.reason || fallback.ai_match_reason).slice(0, 280),
    };
  } catch {
    return fallback;
  }
}

async function rankRunJobs({ runId, candidateId, resumeText, profile, limit = 40 }) {
  const jobs = await Job.find({
    crawl_run_id: runId,
    candidate_id: candidateId,
    freshness: "fresh",
    url_status: "valid_open",
    source: "naukri",
  })
    .sort("-match_score")
    .limit(limit);

  const ranked = [];
  for (const job of jobs) {
    const result = await rankJob({ job, resumeText, profile, runId });
    job.ai_match_score = result.ai_match_score;
    job.ai_match_reason = result.ai_match_reason;
    await job.save();
    ranked.push(job);
  }
  return ranked;
}

module.exports = { rankJob, rankRunJobs };
