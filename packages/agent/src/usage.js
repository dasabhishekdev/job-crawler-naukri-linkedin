const { CrawlRun } = require("@jobportal/db");

const INPUT_USD_PER_M = Number(process.env.OPENAI_INPUT_USD_PER_M) || 0.15;
const OUTPUT_USD_PER_M = Number(process.env.OPENAI_OUTPUT_USD_PER_M) || 0.6;

function costFromUsage(usage) {
  const prompt = Number(usage?.prompt_tokens || 0);
  const completion = Number(usage?.completion_tokens || 0);
  return (prompt / 1e6) * INPUT_USD_PER_M + (completion / 1e6) * OUTPUT_USD_PER_M;
}

async function recordOpenAiUsage(runId, response) {
  if (!runId || !response?.usage) return { prompt: 0, completion: 0, cost: 0 };
  const prompt = Number(response.usage.prompt_tokens || 0);
  const completion = Number(response.usage.completion_tokens || 0);
  const cost = costFromUsage(response.usage);
  await CrawlRun.findByIdAndUpdate(runId, {
    $inc: {
      openai_prompt_tokens: prompt,
      openai_completion_tokens: completion,
      openai_cost_usd: cost,
    },
  });
  return { prompt, completion, cost };
}

module.exports = { recordOpenAiUsage, costFromUsage, INPUT_USD_PER_M, OUTPUT_USD_PER_M };
