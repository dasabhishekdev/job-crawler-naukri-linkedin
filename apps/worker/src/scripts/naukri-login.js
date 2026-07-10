const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const storagePath =
  process.env.NAUKRI_STORAGE_STATE ||
  path.resolve(__dirname, "../../data/naukri-storage-state.json");

async function main() {
  const dir = path.dirname(storagePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  console.log("Opening Naukri login page...");
  console.log("Log in manually in the browser window, then press Enter here.");

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("https://www.naukri.com/nlogin/login", { waitUntil: "domcontentloaded" });

  await new Promise((resolve) => {
    process.stdin.once("data", resolve);
  });

  await context.storageState({ path: storagePath });
  console.log(`Session saved to ${storagePath}`);
  await browser.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
