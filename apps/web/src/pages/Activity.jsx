import { useCallback, useRef, useState } from "react";
import { api } from "../api";
import { usePoll } from "../hooks";
import { Alert, Button, Empty, Sheet, formatDateTime, timeAgo } from "../components/ui";
import { LiveConsole, KIND_LABELS } from "../components/LiveConsole";
import { AgentMemory } from "../components/AgentMemory";

const TABS = [
  { id: "live", label: "Live" },
  { id: "history", label: "History" },
  { id: "memory", label: "Memory" },
];

const STATUS_TONES = { completed: "badge-green", failed: "badge-red", cancelled: "badge-orange", running: "badge-blue", queued: "badge" };

function summary(run) {
  const c = run.counters || {};
  switch (run.kind) {
    case "crawl":
    case "portal_crawl":
      return run.status === "completed" || c.found
        ? `${c.found || 0} found · ${c.new || 0} new · ${c.scored || 0} scored · ${c.relevant || 0} good matches`
        : run.detail || "";
    case "generate_resume":
      return run.result ? `ATS ${run.result.ats_before ?? "?"}% → ${run.result.ats_after ?? "?"}%` : run.detail || "";
    case "parse_resume":
      return run.result ? `${run.result.target_roles} roles, ${run.result.skills} skills` : run.detail || "";
    case "naukri_refresh":
      return run.result ? (run.result.confirmed ? `Uploaded ${run.result.filename}` : "Upload sent, not confirmed") : run.detail || "";
    default:
      return run.detail || "";
  }
}

function RunDetail({ run }) {
  return (
    <div className="stack">
      <p className="muted small">
        Started {formatDateTime(run.started_at || run.createdAt)}
        {run.finished_at ? ` · finished ${formatDateTime(run.finished_at)}` : ""}
      </p>
      {run.error ? <Alert tone="error">{run.error}</Alert> : null}
      <LiveConsole runId={run._id} title={KIND_LABELS[run.kind] || "Run"} height="60vh" />
    </div>
  );
}

export function ActivityPage() {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(null);
  const [tab, setTab] = useState("live");
  const statuses = useRef({});
  const known = useRef(new Set());

  const load = useCallback(async () => {
    try {
      const list = (await api.listRuns({ limit: 30 })).runs;
      known.current = new Set(list.map((r) => r._id));
      setRuns(list);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  usePoll(load, tab === "history" ? 8000 : 30000);

  const onRunUpdate = useCallback(
    (liveRuns) => {
      let changed = false;
      for (const r of Object.values(liveRuns)) {
        if (statuses.current[r._id] === r.status) continue;
        if (r._id in statuses.current || !known.current.has(r._id)) changed = true;
        statuses.current[r._id] = r.status;
      }
      if (changed) load();
    },
    [load]
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Activity</h1>
          <p className="muted small">Watch searches, AI scoring and resume writing as they happen.</p>
        </div>
        <Button variant="secondary" onClick={() => api.startCrawl().then(load).catch((e) => setError(e.message))}>
          Search now
        </Button>
      </header>
      <Alert tone="error">{error}</Alert>

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-active" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "live" ? <LiveConsole onRunUpdate={onRunUpdate} /> : null}
      {tab === "memory" ? <AgentMemory /> : null}

      {tab !== "history" ? null : runs === null ? (
        <p className="muted">Loading…</p>
      ) : runs.length ? (
        <ul className="list card">
          {runs.map((run) => (
            <li key={run._id} className="list-row clickable" onClick={() => setOpen(run)}>
              <div className="grow min0">
                <p className="strong">
                  {KIND_LABELS[run.kind] || run.kind}
                  <span className="muted small"> · {run.triggered_by === "schedule" ? "scheduled" : run.triggered_by} · {timeAgo(run.createdAt)}</span>
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
      <Sheet open={Boolean(open)} onClose={() => setOpen(null)} title="Run details">
        {open ? <RunDetail run={open} /> : null}
      </Sheet>
    </div>
  );
}
