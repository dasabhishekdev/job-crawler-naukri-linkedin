const { AgentEvent, CrawlRun } = require("@jobportal/db");

async function emitAgentEvent({
  runId,
  candidateId,
  stage,
  tool,
  message,
  level = "info",
  jobId = null,
  meta = null,
}) {
  if (!message) return null;
  const doc = await AgentEvent.create({
    run_id: runId || undefined,
    candidate_id: candidateId || undefined,
    stage,
    tool: tool || undefined,
    message,
    level,
    job_id: jobId || undefined,
    meta: meta || undefined,
    created_at: new Date(),
  });
  return doc;
}

async function setAgentStage(runId, patch) {
  if (!runId) return;
  await CrawlRun.findByIdAndUpdate(runId, { $set: patch });
}

module.exports = { emitAgentEvent, setAgentStage };
