const { Run, RunLog } = require("@jobportal/db");

class RunCancelled extends Error {
  constructor() {
    super("Run cancelled");
    this.name = "RunCancelled";
  }
}

function createRunContext(run) {
  const tag = `[${run.kind} ${String(run._id).slice(-6)}]`;

  async function write(level, message) {
    const text = String(message).slice(0, 1000);
    (level === "error" ? console.error : console.log)(`${tag} ${text}`);
    await RunLog.create({ run_id: run._id, user_id: run.user_id, level, message: text }).catch(() => {});
  }

  return {
    run,
    log: {
      info: (m) => write("info", m),
      warn: (m) => write("warn", m),
      error: (m) => write("error", m),
    },
    async stage(stage, detail = "") {
      await Run.updateOne({ _id: run._id }, { $set: { stage, detail, heartbeat_at: new Date() } });
    },
    async count(counters) {
      const set = Object.fromEntries(Object.entries(counters).map(([k, v]) => [`counters.${k}`, v]));
      await Run.updateOne({ _id: run._id }, { $set: set });
    },
    async checkCancel() {
      const current = await Run.findById(run._id, "cancel_requested status").lean();
      if (current?.cancel_requested || current?.status === "cancelled") throw new RunCancelled();
    },
  };
}

module.exports = { createRunContext, RunCancelled };
