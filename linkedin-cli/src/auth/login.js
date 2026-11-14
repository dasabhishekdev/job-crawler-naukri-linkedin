const { chromium } = require("playwright");
const fs = require("fs");
const config = require("../config");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto("https://www.linkedin.com/login");

  console.log("Log in to LinkedIn manually, then press Enter to save your session...");
  process.stdin.once("data", async () => {
    await page.context().storageState({ path: config.storageStatePath });
    console.log(`Session saved to ${config.storageStatePath}`);
    await browser.close();
    process.exit(0);
  });
})();
