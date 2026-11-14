const { connectDb, mongoose } = require("@jobportal/db");
const { loadConfig } = require("./config");
const { createApp } = require("./app");

async function main() {
  const config = loadConfig();
  await connectDb(config.mongoUri);
  const server = createApp(config).listen(config.port, () => {
    console.log(`API listening on :${config.port} (public URL ${config.publicUrl})`);
  });

  async function shutdown(signal) {
    console.log(`${signal} received, closing API…`);
    server.close(async () => {
      await mongoose.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000).unref();
  }
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error("API failed to start:", err.message);
  process.exit(1);
});
