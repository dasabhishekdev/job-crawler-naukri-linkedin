const http = require("http");
const { WebSocketServer } = require("ws");
const { chromium } = require("playwright");
const { connectDb, mongoose } = require("@jobportal/db");
const { consumeTicket } = require("@jobportal/portals");
const { LoginSession } = require("./login-session");

const PORT = Number(process.env.BROWSER_PORT) || 5100;
const WS_PATH = "/api/portals/ws";
const MAX_SESSIONS = Number(process.env.MAX_LOGIN_SESSIONS) || 3;
const publicUrl = (process.env.PUBLIC_URL || "http://localhost:3006").replace(/\/+$/, "");
const allowedOrigins = new Set([
  new URL(publicUrl).origin,
  ...(process.env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),
]);

const sessions = new Set();
let browserPromise = null;

function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium
      .launch({
        headless: true,
        channel: "chromium",
        args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-blink-features=AutomationControlled"],
      })
      .then((browser) => {
        browser.on("disconnected", () => {
          browserPromise = null;
        });
        return browser;
      })
      .catch((err) => {
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

function reject(socket, code, text) {
  socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

async function handleConnection(ws, ticket) {
  for (const existing of sessions) {
    if (String(existing.userId) === String(ticket.user_id)) await existing.close("closed", "Opened in another window.");
  }
  if (sessions.size >= MAX_SESSIONS) {
    ws.send(JSON.stringify({ type: "status", state: "busy", message: "All login windows are in use. Try again in a minute." }));
    return ws.close(1013, "busy");
  }
  const session = new LoginSession({ browser: await getBrowser(), ws, ticket, onClose: (s) => sessions.delete(s) });
  sessions.add(session);
  ws.on("message", (data, isBinary) => {
    if (!isBinary) session.handleInput(data.toString()).catch(() => {});
  });
  ws.on("close", () => session.close("closed").catch(() => {}));
  try {
    await session.start();
  } catch (err) {
    console.error("[browser] session start failed:", err.message);
    await session.close("error", "Could not open the login window. Please try again.");
  }
}

const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    const ok = mongoose.connection.readyState === 1;
    res.writeHead(ok ? 200 : 503, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: ok ? "ok" : "degraded", sessions: sessions.size, max: MAX_SESSIONS }));
  }
  res.writeHead(404).end();
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

server.on("upgrade", async (req, socket, head) => {
  const url = new URL(req.url, "http://internal");
  if (url.pathname !== WS_PATH) return reject(socket, 404, "Not Found");
  if (!allowedOrigins.has(req.headers.origin)) return reject(socket, 403, "Forbidden");
  const ticket = await consumeTicket(url.searchParams.get("ticket")).catch(() => null);
  if (!ticket) return reject(socket, 401, "Unauthorized");
  wss.handleUpgrade(req, socket, head, (ws) => {
    handleConnection(ws, ticket).catch((err) => {
      console.error("[browser]", err.message);
      ws.close(1011, "error");
    });
  });
});

async function main() {
  if (!process.env.APP_ENCRYPTION_KEY) throw new Error("APP_ENCRYPTION_KEY is required");
  await connectDb(process.env.MONGODB_URI || "mongodb://localhost:27017/jobportal");
  server.listen(PORT, () => console.log(`Login browser listening on :${PORT}${WS_PATH} (max ${MAX_SESSIONS} sessions)`));

  async function shutdown() {
    for (const s of sessions) await s.close("closed", "Server restarting.");
    const browser = await browserPromise?.catch(() => null);
    await browser?.close().catch(() => {});
    await mongoose.disconnect();
    process.exit(0);
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error("Login browser failed to start:", err.message);
  process.exit(1);
});
