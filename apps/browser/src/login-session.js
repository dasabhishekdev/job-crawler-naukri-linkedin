const {
  PORTAL_META,
  contextOptions,
  isAllowedNavigation,
  isLoggedIn,
  validateInput,
  saveConnection,
} = require("@jobportal/portals");

const IDLE_MS = 5 * 60 * 1000;
const MAX_MS = 15 * 60 * 1000;
const DETECT_MS = 1500;
const MAX_BUFFERED = 2 * 1024 * 1024;

/**
 * One private login window: an incognito browser context streamed to a single WebSocket.
 * Nothing is written to disk; on success only the encrypted storage state is saved.
 */
class LoginSession {
  constructor({ browser, ws, ticket, onClose }) {
    this.browser = browser;
    this.ws = ws;
    this.userId = ticket.user_id;
    this.portal = ticket.portal;
    this.options = contextOptions(ticket.viewport || {});
    this.viewport = this.options.viewport;
    this.onClose = onClose;
    this.closed = false;
    this.cdp = null;
    this.activePage = null;
    this.timers = [];
  }

  send(message) {
    if (this.ws.readyState === this.ws.OPEN) this.ws.send(JSON.stringify(message));
  }

  status(state, message = "") {
    this.send({ type: "status", state, message });
  }

  async start() {
    this.status("starting", "Opening a private browser…");
    this.context = await this.browser.newContext(this.options);
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    });
    await this.context.route("**/*", (route) => {
      const request = route.request();
      let isTopLevel = false;
      try {
        const frame = request.frame();
        isTopLevel = request.isNavigationRequest() && frame === frame.page().mainFrame();
      } catch {
        isTopLevel = false;
      }
      if (isTopLevel && !isAllowedNavigation(request.url(), this.portal)) {
        this.status("ready", `Blocked a link outside ${PORTAL_META[this.portal].label}.`);
        return route.abort("blockedbyclient");
      }
      return route.continue();
    });
    this.context.on("page", (page) => this.adoptPopup(page));

    this.mainPage = await this.context.newPage();
    await this.attach(this.mainPage);
    await this.mainPage.goto(PORTAL_META[this.portal].loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 }).catch(() => {});
    this.status("ready", `Sign in to ${PORTAL_META[this.portal].label}.`);

    this.lastInput = Date.now();
    this.startedAt = Date.now();
    this.timers.push(setInterval(() => this.tick().catch(() => {}), DETECT_MS));
  }

  async adoptPopup(page) {
    if (page === this.mainPage || this.closed) return;
    page.on("close", () => {
      if (!this.closed && this.activePage === page) this.attach(this.mainPage).catch(() => {});
    });
    await this.attach(page).catch(() => {});
  }

  async attach(page) {
    if (this.cdp) {
      await this.cdp.send("Page.stopScreencast").catch(() => {});
      await this.cdp.detach().catch(() => {});
    }
    this.activePage = page;
    this.cdp = await this.context.newCDPSession(page);
    this.cdp.on("Page.screencastFrame", (frame) => this.onFrame(frame));
    const scale = this.options.deviceScaleFactor || 1;
    await this.cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      maxWidth: Math.round(this.viewport.width * scale),
      maxHeight: Math.round(this.viewport.height * scale),
      everyNthFrame: 1,
    });
  }

  async onFrame({ data, sessionId, metadata }) {
    this.send({ type: "frame", data, width: metadata.deviceWidth, height: metadata.deviceHeight });
    const cdp = this.cdp;
    const ack = () => cdp?.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    if (this.ws.bufferedAmount < MAX_BUFFERED) return ack();
    const wait = setInterval(() => {
      if (this.closed || this.ws.bufferedAmount < MAX_BUFFERED) {
        clearInterval(wait);
        if (!this.closed) ack();
      }
    }, 50);
  }

  async handleInput(raw) {
    if (this.closed) return;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    const cmd = validateInput(parsed, this.viewport);
    if (!cmd) return;
    this.lastInput = Date.now();
    const page = this.activePage;
    switch (cmd.t) {
      case "tap":
        if (this.options.hasTouch) await page.touchscreen.tap(cmd.x, cmd.y);
        else await page.mouse.click(cmd.x, cmd.y);
        break;
      case "scroll":
        await page.mouse.move(cmd.x, cmd.y);
        await page.mouse.wheel(0, cmd.dy);
        break;
      case "text":
        await page.keyboard.insertText(cmd.text);
        break;
      case "key":
        await page.keyboard.press(cmd.key);
        break;
      case "back":
        await page.goBack({ timeout: 15000 }).catch(() => {});
        break;
      case "reload":
        await page.reload({ timeout: 30000 }).catch(() => {});
        break;
      default: {
        const unknown = cmd.t;
        throw new Error(`Unhandled input ${unknown}`);
      }
    }
  }

  async tick() {
    if (this.closed) return;
    const now = Date.now();
    if (now - this.lastInput > IDLE_MS) return this.close("closed", "Closed after 5 minutes without activity.");
    if (now - this.startedAt > MAX_MS) return this.close("closed", "The login window timed out. Please try again.");

    const meta = PORTAL_META[this.portal];
    const cookies = await this.context.cookies(meta.cookieUrl);
    if (!isLoggedIn(this.portal, cookies, this.mainPage.url())) return;

    this.status("saving", "Signed in. Saving your session…");
    await new Promise((r) => setTimeout(r, 2500));
    const state = await this.context.storageState();
    await saveConnection(this.userId, this.portal, state);
    await this.close("connected", `${meta.label} connected.`);
  }

  async close(state = "closed", message = "") {
    if (this.closed) return;
    this.closed = true;
    for (const t of this.timers) clearInterval(t);
    this.status(state, message);
    await this.context?.close().catch(() => {});
    if (this.ws.readyState === this.ws.OPEN) this.ws.close(1000, state);
    this.onClose?.(this);
  }
}

module.exports = { LoginSession };
