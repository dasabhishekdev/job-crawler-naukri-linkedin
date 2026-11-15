const { postedAgeDays } = require("./normalize");
const { looksExpiredText } = require("./freshness-signals");

const BATCH = 8;

function validatePrompt({ jobs, maxAgeDays }) {
  return `You verify whether job postings are still OPEN and recently posted.

Today is ${new Date().toISOString().slice(0, 10)}. Max acceptable age: ${maxAgeDays} days.

For each job, decide:
- open: clearly accepting applications now
- expired: closed, filled, no longer accepting applications, removed, or past deadline
- stale: still listed but clearly older than ${maxAgeDays} days
- unknown: cannot tell from the text

Return JSON: {"results":[{"id":"0","status":"open|expired|stale|unknown","posted":"best date or relative age if any","reason":"short"}]}

Jobs:
${jobs
  .map(
    (j, i) => `### id: ${i}
Title: ${j.title}
Company: ${j.company}
Location: ${j.location || ""}
Posted hint: ${j.posted || j.posted_text || "unknown"}
URL: ${j.job_url || j.apply_url || ""}
Snippet:
${String(j.description || "").slice(0, 900)}`
  )
  .join("\n\n")}`;
}

/**
 * AI + heuristics: drop expired/stale postings before they are stored.
 * Mutates surviving jobs' `posted` when the model finds a clearer date.
 */
async function validateJobsOpen({ ai, jobs, maxAgeDays = 14, log }) {
  if (!jobs.length) return { open: [], dropped: 0 };

  const open = [];
  let dropped = 0;
  let heuristic = 0;

  for (let i = 0; i < jobs.length; i += BATCH) {
    const batch = jobs.slice(i, i + BATCH);
    const kept = [];
    for (const job of batch) {
      const blob = `${job.posted || ""} ${job.title || ""} ${String(job.description || "").slice(0, 1500)}`;
      if (looksExpiredText(blob)) {
        dropped++;
        heuristic++;
        continue;
      }
      const age = postedAgeDays(job.posted || job.posted_text);
      if (age !== null && age > maxAgeDays) {
        dropped++;
        heuristic++;
        continue;
      }
      kept.push(job);
    }
    if (!kept.length) continue;

    let verdicts = [];
    try {
      const reply = await ai.json(validatePrompt({ jobs: kept, maxAgeDays }), {
        maxTokens: 220 * kept.length,
        label: `Validating ${kept.length} jobs are still open`,
        reserve: 0.1,
      });
      verdicts = Array.isArray(reply?.results) ? reply.results : Array.isArray(reply) ? reply : [];
    } catch (err) {
      if (["AiKeyError", "BudgetExceededError", "RunCancelled"].includes(err.name)) throw err;
      if (log) await log.warn(`Open-job validation failed (${err.message}); keeping heuristically fresh results`);
      open.push(...kept);
      continue;
    }

    for (const [idx, job] of kept.entries()) {
      const v = verdicts.find((r) => String(r.id) === String(idx)) || verdicts[idx];
      const status = String(v?.status || "unknown").toLowerCase();
      if (v?.posted) job.posted = String(v.posted).slice(0, 80);
      if (status === "expired" || status === "stale") {
        dropped++;
        continue;
      }
      const age = postedAgeDays(job.posted || job.posted_text);
      if (age !== null && age > maxAgeDays) {
        dropped++;
        continue;
      }
      open.push(job);
    }
  }

  if (log && dropped) {
    await log.info(`Freshness check: kept ${open.length}, dropped ${dropped} expired/stale${heuristic ? ` (${heuristic} by page signals)` : ""}`);
  }
  return { open, dropped };
}

module.exports = { validateJobsOpen, validatePrompt };
