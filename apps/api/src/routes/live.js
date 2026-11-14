const express = require("express");
const { Run, RunLog, mongoose } = require("@jobportal/db");
const { HttpError } = require("../lib/http-error");

const LOG_FIELDS = "run_id kind level tag message created_at";
const RUN_FIELDS = "kind status triggered_by stage detail counters error started_at finished_at createdAt updatedAt";
const MAX_STREAMS_PER_USER = 3;
const LOG_POLL_MS = 1000;
const RUN_POLL_MS = 2000;
const HEARTBEAT_MS = 20000;

const openStreams = new Map();

/** Server-Sent Events: live run log lines (`logs`) and run status changes (`runs`) for the signed-in user. */
function liveRouter() {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const userKey = String(req.user._id);
    if ((openStreams.get(userKey) || 0) >= MAX_STREAMS_PER_USER) {
      throw new HttpError(429, "Too many live views are open. Close another tab and try again.");
    }
    const runId = mongoose.isValidObjectId(req.query.run_id) ? new mongoose.Types.ObjectId(String(req.query.run_id)) : null;
    const logFilter = { user_id: req.user._id, ...(runId ? { run_id: runId } : {}) };
    const runFilter = { user_id: req.user._id, ...(runId ? { _id: runId } : {}) };

    openStreams.set(userKey, (openStreams.get(userKey) || 0) + 1);
    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    let closed = false;
    const send = (event, data) => {
      if (!closed) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const backlog = await RunLog.find(logFilter, LOG_FIELDS).sort({ _id: -1 }).limit(runId ? 300 : 100).lean();
    let lastLogId = backlog[0]?._id || mongoose.Types.ObjectId.createFromTime(Math.floor(Date.now() / 1000));
    send("logs", backlog.reverse());
    const sentVersions = new Map();
    const sendRuns = (runs) => {
      const fresh = runs.filter((r) => sentVersions.get(String(r._id)) !== String(r.updatedAt));
      for (const r of fresh) sentVersions.set(String(r._id), String(r.updatedAt));
      if (fresh.length) send("runs", fresh);
    };
    send("runs", []);
    sendRuns(await Run.find(runFilter, RUN_FIELDS).sort({ createdAt: -1 }).limit(runId ? 1 : 10).lean());
    let lastRunCheck = new Date();

    let busy = false;
    const logTimer = setInterval(async () => {
      if (busy || closed) return;
      busy = true;
      try {
        const logs = await RunLog.find({ ...logFilter, _id: { $gt: lastLogId } }, LOG_FIELDS).sort({ _id: 1 }).limit(200).lean();
        if (logs.length) {
          lastLogId = logs[logs.length - 1]._id;
          send("logs", logs);
        }
      } catch {
        /* transient DB error: retry on the next tick */
      } finally {
        busy = false;
      }
    }, LOG_POLL_MS);

    const runTimer = setInterval(async () => {
      if (closed) return;
      const since = new Date(lastRunCheck.getTime() - 3000);
      lastRunCheck = new Date();
      const runs = await Run.find({ ...runFilter, updatedAt: { $gte: since } }, RUN_FIELDS).sort({ createdAt: -1 }).limit(20).lean().catch(() => []);
      sendRuns(runs);
    }, RUN_POLL_MS);

    const heartbeat = setInterval(() => !closed && res.write(": ping\n\n"), HEARTBEAT_MS);

    req.on("close", () => {
      closed = true;
      clearInterval(logTimer);
      clearInterval(runTimer);
      clearInterval(heartbeat);
      const left = (openStreams.get(userKey) || 1) - 1;
      if (left > 0) openStreams.set(userKey, left);
      else openStreams.delete(userKey);
    });
  });

  return router;
}

module.exports = { liveRouter };
