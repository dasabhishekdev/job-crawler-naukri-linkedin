const fs = require("fs");
const { generateHeadline, resolveNaukriStoragePath, emitAgentEvent } = require("@jobportal/agent");
const { findResumePdf, delay } = require("../utils");

function looksLikeLogin(pageUrl, bodyText) {
  const url = (pageUrl || "").toLowerCase();
  const body = (bodyText || "").toLowerCase();
  return (
    url.includes("nlogin") ||
    url.includes("/login") ||
    body.includes("login to apply") ||
    (body.includes("enter your email") && body.includes("password"))
  );
}

async function checkNaukriSession(page) {
  await page.goto("https://www.naukri.com/mnjuser/homepage", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await delay(2000);
  const bodyText = (await page.textContent("body").catch(() => "")) || "";
  if (looksLikeLogin(page.url(), bodyText)) {
    return { ok: false, reason: "Naukri session expired — login required" };
  }
  return { ok: true };
}

async function fillHeadline(page, headline) {
  const selectors = [
    'input[placeholder*="Headline" i]',
    'textarea[placeholder*="Headline" i]',
    'input[name*="resumeHeadline" i]',
    'textarea[name*="resumeHeadline" i]',
    "#resumeHeadline",
    '[data-test="resumeHeadline"] textarea',
    '[class*="headline"] input',
    '[class*="headline"] textarea',
  ];
  for (const selector of selectors) {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      await el.fill(headline);
      return true;
    }
  }
  return false;
}

async function clickSave(page) {
  const selectors = [
    'button:has-text("Save")',
    'button:has-text("Update")',
    'button:has-text("Submit")',
    'button[type="submit"]',
  ];
  for (const selector of selectors) {
    const btn = page.locator(selector).first();
    if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await btn.click();
      await delay(2000);
      return true;
    }
  }
  return false;
}

async function bumpNaukriProfile({ browser, candidate, resumeText, profile, config, runId, log }) {
  const storagePath = resolveNaukriStoragePath(candidate);
  if (!fs.existsSync(storagePath)) {
    return { ok: false, needsLogin: true, error: "No Naukri session file" };
  }

  const resumePath = findResumePdf(config.resumeDir);
  const headline = await generateHeadline({ resumeText, profile, runId });
  const context = await browser.newContext({ storageState: storagePath });
  const page = await context.newPage();

  try {
    const session = await checkNaukriSession(page);
    if (!session.ok) {
      await emitAgentEvent({
        runId,
        candidateId: candidate._id,
        stage: "session",
        tool: "check_naukri_session",
        message: session.reason,
        level: "warn",
      });
      return { ok: false, needsLogin: true, error: session.reason };
    }

    await emitAgentEvent({
      runId,
      candidateId: candidate._id,
      stage: "profile",
      tool: "update_naukri_profile",
      message: `Updating Naukri profile headline: ${headline}`,
    });

    await page.goto("https://www.naukri.com/mnjuser/profile", {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await delay(2500);

    if (resumePath) {
      const fileInput = page.locator('input[type="file"]').first();
      if (await fileInput.count()) {
        await fileInput.setInputFiles(resumePath).catch(() => {});
        await delay(1500);
        if (log) await log.info("Re-uploaded resume PDF on Naukri profile");
      }
    }

    const filled = await fillHeadline(page, headline);
    await clickSave(page);

    candidate.last_profile_updated_at = new Date();
    await candidate.save();

    await emitAgentEvent({
      runId,
      candidateId: candidate._id,
      stage: "profile",
      tool: "update_naukri_profile",
      message: filled
        ? "Profile saved (resume + headline)"
        : "Profile touched — headline field not found, resume/save attempted",
    });

    return { ok: true, headline, filled };
  } catch (err) {
    if (log) await log.warn(`Profile bump failed: ${err.message}`);
    await emitAgentEvent({
      runId,
      candidateId: candidate._id,
      stage: "profile",
      tool: "update_naukri_profile",
      message: `Profile update failed: ${err.message}`,
      level: "error",
    });
    return { ok: false, error: err.message };
  } finally {
    await context.close();
  }
}

module.exports = { bumpNaukriProfile, checkNaukriSession, looksLikeLogin };
