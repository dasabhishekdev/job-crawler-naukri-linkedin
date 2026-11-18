import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveFeed } from "../hooks";

export const KIND_LABELS = {
  crawl: "Job search",
  portal_crawl: "LinkedIn / Naukri",
  parse_resume: "Resume",
  generate_resume: "Tailored resume",
  naukri_refresh: "Naukri refresh",
  auto_apply: "Auto-apply",
  check_links: "Check expired",
};

const TAG_LABELS = { ai: "AI", search: "Search", job: "Job", step: "Step" };

const FILTERS = [
  { id: "all", label: "All", test: () => true },
  { id: "ai", label: "AI", test: (l) => l.tag === "ai" || l.tag === "search" },
  { id: "job", label: "Jobs", test: (l) => l.tag === "job" },
  { id: "problems", label: "Problems", test: (l) => l.level !== "info" },
];

const STAGE_TEXT = {
  search: "Searching",
  score: "Scoring",
  sync: "Updating sheet",
  parse: "Reading resume",
  write: "Writing resume",
  pdf: "Creating PDF",
  upload: "Uploading",
  apply: "Applying",
  check: "Checking links",
};

function time(value) {
  return new Date(value).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Live, terminal-style feed of background work and AI operations. */
export function LiveConsole({ runId, title = "Live activity", height, onRunUpdate }) {
  const { lines, runs, connected } = useLiveFeed({ runId });
  const [filter, setFilter] = useState("all");
  const [follow, setFollow] = useState(true);
  const box = useRef(null);

  const active = useMemo(
    () => Object.values(runs).filter((r) => r.status === "running" || r.status === "queued"),
    [runs]
  );
  const visible = useMemo(() => lines.filter(FILTERS.find((f) => f.id === filter).test), [lines, filter]);

  useEffect(() => {
    if (onRunUpdate && Object.keys(runs).length) onRunUpdate(runs);
  }, [runs, onRunUpdate]);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [visible, follow]);

  function onScroll() {
    const el = box.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    if (atBottom !== follow) setFollow(atBottom);
  }

  return (
    <section className="live-console" aria-label={title}>
      <header className="live-head">
        <div className="row gap min0">
          <span className={`live-dot ${connected ? "is-on" : ""}`} aria-hidden="true" />
          <h2 className="truncate">{title}</h2>
          <span className="muted small">{connected ? "live" : "reconnecting…"}</span>
        </div>
        <div className="live-filters" role="group" aria-label="Filter log lines">
          {FILTERS.map((f) => (
            <button key={f.id} type="button" className={filter === f.id ? "is-active" : ""} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </header>

      {active.length ? (
        <div className="live-active">
          {active.map((r) => (
            <span key={r._id} className="live-run">
              <span className="spinner" aria-hidden="true" />
              <strong>{KIND_LABELS[r.kind] || r.kind}</strong>
              <span className="muted">
                {r.status === "queued" ? "queued" : STAGE_TEXT[r.stage] || r.stage || "starting"}
                {r.counters?.found ? ` · ${r.counters.found} found` : ""}
                {r.counters?.scored ? ` · ${r.counters.scored} scored` : ""}
              </span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="live-log" ref={box} onScroll={onScroll} role="log" aria-live="polite" style={height ? { height } : undefined}>
        {visible.length ? (
          visible.map((l) => (
            <p key={l._id} className={`live-line level-${l.level} tag-${l.tag || "step"}`}>
              <time>{time(l.created_at)}</time>
              {!runId && l.kind ? <span className="live-kind">{KIND_LABELS[l.kind] || l.kind}</span> : null}
              {l.tag && l.tag !== "step" ? <span className="live-tag">{TAG_LABELS[l.tag]}</span> : null}
              <span className="live-msg">{l.message}</span>
            </p>
          ))
        ) : (
          <p className="live-empty">
            {lines.length ? "No lines match this filter." : "Waiting for activity. Start a search and you will see the AI working here, live."}
          </p>
        )}
      </div>

      {!follow ? (
        <button
          type="button"
          className="live-jump"
          onClick={() => {
            setFollow(true);
            if (box.current) box.current.scrollTop = box.current.scrollHeight;
          }}
        >
          Jump to latest ↓
        </button>
      ) : null}
    </section>
  );
}
