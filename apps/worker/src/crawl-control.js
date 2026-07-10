let activeBrowser = null;

function setActiveBrowser(browser) {
  activeBrowser = browser;
}

async function closeActiveBrowser() {
  if (!activeBrowser) return;
  try {
    await activeBrowser.close();
  } catch {
    // ignore close errors during force stop
  }
  activeBrowser = null;
}

module.exports = { setActiveBrowser, closeActiveBrowser };
