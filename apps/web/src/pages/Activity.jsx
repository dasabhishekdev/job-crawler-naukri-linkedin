import { useCallback, useState } from "react";
import { api } from "../api";
import { usePoll } from "../hooks";
import { Alert, Button, Empty, Sheet, formatDateTime, timeAgo } from "../components/ui";

const KIND_LABELS = { crawl: "Job search", parse_resume: "Resume analysis", generate_resume: "Tailored resume" };
const STATUS_TONES = { completed: "badge-green", failed: "badge-red", cancelled: "badge-orange", running: "badge-blue", queued: "badge" };

function summary(run) {
  const c = run.counters || {};
  switch (run.kind) {
    case "crawl":
      return run.status === "completed" || c.found
        ? `${c.found || 0} found · ${c.new || 0} new · ${c.scored || 0} scored · ${c.relevant || 0} good matches`
        : run.detail || "";
    case "generate_resume":
      return run.result ? `ATS ${run.result.ats_before ?? "?"}% → ${run.result.ats_after ?? "?"}%` : run.detail || "";
    case "parse_resume":
      return run.result ? `${run.result.target_roles} roles, ${run.result.skills} skills` : run.detail || "";
    default:
      return run.detail || "";
  }
}

function RunLogs({ runId }) {
  const [data, setData] = useState(null);
  usePoll(async () => setData(await api.getRun(runId)), 4000, Boolean(runId) && (!data || ["queued", "running"].includes(data.run.status)));
  if (!data) return <p className="muted">Loading…</p>;
  return (
    <div className="stack">
      <p className="muted small">
        Started {formatDateTime(data.run.started_at || data.run.createdAt)}
        {data.run.finished_at ? ` · finished ${formatDateTime(data.run.finished_at)}` : ""}
      </p>
      {data.run.error ? <Alert tone="error">{data.run.error}</Alert> : null}
      <div className="log-box" role="log">
        {data.logs.length ? (
          data.logs.map((l) => (
            <p key={l._id} className={`log log-${l.level}`}>
              <time>{new Date(l.created_at).toLocaleTimeString()}</time> {l.message}
            </p>
          ))
        ) : (
          <p className="muted">No log lines yet.</p>
        )}
      </div>
    </div>
  );
}

export function ActivityPage() {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    try {
      setRuns((await api.listRuns({ limit: 30 })).runs);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const hasActive = runs?.some((r) => ["queued", "running"].includes(r.status));
  usePoll(load, hasActive ? 4000 : 20000);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Activity</h1>
          <p className="muted small">Searches, resume analysis and generated resumes.</p>
        </div>
        <Button variant="secondary" onClick={() => api.startCrawl().then(load).catch((e) => setError(e.message))}>
          Search now
        </Button>
      </header>
      <Alert tone="error">{error}</Alert>
      {runs === null ? (
        <p className="muted">Loading…</p>
      ) : runs.length ? (
        <ul className="list card">
          {runs.map((run) => (
            <li key={run._id} className="list-row clickable" onClick={() => setOpenId(run._id)}>
              <div className="grow min0">
                <p className="strong">
                  {KIND_LABELS[run.kind] || run.kind}
                  <span className="muted small"> · {run.triggered_by === "schedule" ? "hourly" : run.triggered_by} · {timeAgo(run.createdAt)}</span>
                </p>
                <p className="muted small truncate">{run.error || summary(run)}</p>
              </div>
              <span className={`badge ${STATUS_TONES[run.status] || ""}`}>{run.status}</span>
              {["queued", "running"].includes(run.status) ? (
                <button
                  type="button"
                  className="link-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    api.cancelRun(run._id).then(load).catch((err) => setError(err.message));
                  }}
                >
                  Cancel
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="Nothing has run yet">Start a search from the Jobs page.</Empty>
      )}
      <Sheet open={Boolean(openId)} onClose={() => setOpenId(null)} title="Run details">
        {openId ? <RunLogs runId={openId} /> : null}
      </Sheet>
    </div>
  );
}
