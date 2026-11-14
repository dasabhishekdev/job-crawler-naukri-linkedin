const { connectDb } = require("@jobportal/db");
const { seedCandidates, hydrateOpenAiEnv } = require("@jobportal/agent");
const { runMultiSource } = require("../multi/run-multi");

async function main() {
  await connectDb(process.env.MONGODB_URI || "mongodb://localhost:27017/jobportal");
  await seedCandidates();
  await hydrateOpenAiEnv();
  const result = await runMultiSource({ triggeredBy: "manual" });
  console.log(result);
  process.exit(result.status === "completed" ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
