const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { Resume, User } = require("@jobportal/db");
const { contextOptions, loadConnectedStates, refreshConnection, markExpired } = require("@jobportal/portals");
const { getBrowser } = require("../browser");
const { open, humanDelay } = require("../portals/common");

const PROFILE_URL = "https://www.naukri.com/mnjuser/profile";
const SUCCESS = /(successfully (uploaded|updated)|uploaded successfully|resume has been (successfully )?(uploaded|updated))/i;

/** Re-uploads the user's current resume on their Naukri profile, which refreshes it for recruiters. */
async function naukriRefreshTask({ user, run, log, stage }) {
  const connection = (await loadConnectedStates(user._id)).find((c) => c.portal === "naukri");
  if (!connection) throw new Error("Connect Naukri in Settings first.");
  const resume = await Resume.findOne({ user_id: user._id, is_current: true }).select("+data").sort("-createdAt");
  if (!resume?.data) throw new Error("Upload your resume first.");

  const dir = await fs.mkdtemp(path.join(process.env.DATA_DIR || os.tmpdir(), "naukri-"));
  const filePath = path.join(dir, resume.filename.replace(/[^\w.-]+/g, "_"));
  await fs.writeFile(filePath, resume.data);

  const browser = await getBrowser();
  const context = await browser.newContext({ ...contextOptions({ mobile: false }), storageState: connection.storageState });
  try {
    await stage("upload", "Uploading your resume to Naukri");
    const page = await context.newPage();
    await open(page, "naukri", PROFILE_URL);
    await humanDelay(1500, 3000);
    const input = page.locator('input[type="file"]#attachCV, input[type="file"]').first();
    if (!(await input.count())) throw new Error("Could not find the resume upload field on your Naukri profile.");
    await input.setInputFiles(filePath);
    const confirmed = await page
      .getByText(SUCCESS)
      .first()
      .waitFor({ timeout: 20000 })
      .then(() => true)
      .catch(() => false);
    await refreshConnection(user._id, "naukri", await context.storageState());
    await User.updateOne({ _id: user._id }, { $set: { "portals.last_naukri_refresh_at": new Date() } });
    if (confirmed) await log.info(`Naukri profile refreshed with ${resume.filename}`);
    else await log.warn("Resume was sent to Naukri, but the success message was not shown. Check your Naukri profile.");
    return { confirmed, filename: resume.filename, run_id: String(run._id) };
  } catch (err) {
    if (err.name === "SessionExpiredError") await markExpired(user._id, "naukri", err.message);
    throw err;
  } finally {
    await context.close().catch(() => {});
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

module.exports = { naukriRefreshTask };
