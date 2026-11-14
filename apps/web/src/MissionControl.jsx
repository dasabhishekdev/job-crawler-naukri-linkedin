const STAGES = [
  { id: "session", label: "Session" },
  { id: "profile", label: "Profile" },
  { id: "discover", label: "Discover" },
  { id: "rank", label: "Rank" },
  { id: "apply", label: "Apply" },
  { id: "report", label: "Report" },
];

function formatCountdown(iso) {
  if (!iso) return "—";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "due now";
  const totalMin = Math.floor(ms / 60000);
  const hours = Math.floor(totalMin / 60);
  const mins = totalMin % 60;
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function formatUsd(n) {
  const v = Number(n || 0);
  if (v < 0.01) return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

export function CandidateSwitcher({ candidates, activeId, onChange, disabled }) {
  return (
    <label className="candidate-switcher">
      <span>Candidate</span>
      <select
        value={activeId || ""}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Select candidate profile"
      >
        {(candidates || []).map((c) => (
          <option key={c._id} value={c._id}>
            {c.name}
            {c.is_active ? " (active)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AgentStatusBadge({ status }) {
  const label =
    status === "running"
      ? "Running"
      : status === "needs_login"
        ? "Needs login"
        : status === "stopped"
          ? "Stopped"
          : "Idle";
  return <span className={`agent-badge agent-${status || "idle"}`}>{label}</span>;
}

function PipelineStepper({ stage, running }) {
  const currentIndex = STAGES.findIndex((s) => s.id === stage);
  return (
    <ol className="pipeline-stepper" aria-label="Agent pipeline">
      {STAGES.map((s, i) => {
        let state = "upcoming";
        if (!running && stage === "report" && i === STAGES.length - 1) state = "done";
        else if (running && i < currentIndex) state = "done";
        else if (running && i === currentIndex) state = "current";
        else if (!running && currentIndex >= 0 && i <= currentIndex) state = "done";
        return (
          <li key={s.id} className={`pipeline-step ${state}`}>
            <span className="pipeline-dot" />
            <span>{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

function ActivityFeed({ events }) {
  if (!events?.length) {
    return <p className="empty feed-empty">Agent events will appear here when a run starts.</p>;
  }
  return (
    <div className="activity-feed" role="log" aria-live="polite">
      {events.map((ev) => (
        <div key={ev._id || `${ev.created_at}-${ev.message}`} className={`feed-row feed-${ev.level || "info"}`}>
          <span className="feed-time">
            {ev.created_at ? new Date(ev.created_at).toLocaleTimeString() : ""}
          </span>
          <span className="feed-stage">{ev.stage}</span>
          <span className="feed-msg">{ev.message}</span>
        </div>
      ))}
    </div>
  );
}

function RankedJobCards({ jobs }) {
  if (!jobs?.length) return null;
  return (
    <div className="job-card-grid">
      {jobs.map((job) => (
        <article key={job._id} className="job-match-card">
          <header>
            <strong>{job.job_title || "Untitled"}</strong>
            <span className={`ai-score ${(job.ai_match_score || 0) >= 70 ? "hot" : ""}`}>
              {job.ai_match_score != null ? `${job.ai_match_score}` : "—"}
            </span>
          </header>
          <p className="job-card-company">{job.company || "Unknown company"}</p>
          <p className="job-card-reason">{job.ai_match_reason || (job.match_reasons || []).slice(0, 2).join(" · ") || "Awaiting AI rank"}</p>
          <footer>
            <span className={`badge apply-${job.application_status}`}>{job.application_status}</span>
            <span className="muted">kw {job.match_score ?? 0}</span>
            <a href={job.job_url} target="_blank" rel="noreferrer">
              Open
            </a>
          </footer>
        </article>
      ))}
    </div>
  );
}

export function MissionControl({
  status,
  stopping,
  crawling,
  onRunAgent,
  onStop,
  onOpenSettings,
}) {
  const running = status?.agent_status === "running";
  const today = status?.today || {};
  const candidate = status?.candidate;
  const openaiReady = Boolean(status?.openai?.verified || status?.openai?.configured);

  return (
    <section className="mission-control">
      <div className="mission-hero">
        <div className="mission-hero-copy">
          <p className="mission-kicker">Daily Naukri agent</p>
          <h2>
            {candidate?.name || "Select a candidate"}
            <AgentStatusBadge status={status?.agent_status} />
          </h2>
          <p className="mission-now">
            {running
              ? `${status.agent_stage || "running"}${status.current_tool ? ` · ${status.current_tool}` : ""}${status.current_job_title ? ` · ${status.current_job_title}` : ""}`
              : status?.agent_status === "needs_login"
                ? "Naukri session expired — save login in the Naukri browser below"
                : `Next run in ${formatCountdown(status?.next_run)} (${status?.schedule || "09:00 / 19:00 IST"})`}
          </p>
        </div>
        <div className="mission-actions">
          <button type="button" disabled={crawling || running} onClick={() => onRunAgent({ live: true })}>
            {crawling ? "Starting…" : "Run Daily Agent"}
          </button>
          {running && (
            <button type="button" className="btn-stop" disabled={stopping} onClick={onStop}>
              {stopping ? "Stopping…" : "Kill switch"}
            </button>
          )}
        </div>
      </div>

      {!openaiReady && (
        <div className="mission-alert" role="status">
          Add an OpenAI key in Settings so ranking, headlines, and auto-apply can run. GPT-4o is recommended.
          <button type="button" className="linkish" onClick={onOpenSettings}>
            Open Settings
          </button>
        </div>
      )}
      {openaiReady && (
        <p className="mission-meta openai-meta">
          Model: <strong>{status.openai.model}</strong>
          {status.openai.masked_key ? ` · ${status.openai.masked_key}` : ""}
        </p>
      )}

      <PipelineStepper stage={status?.agent_stage || "idle"} running={running} />

      <div className="stats-grid mission-stats">
        <div className="stat-card accent-teal">
          <div className="stat-value">{today.profile_updates ?? 0}</div>
          <div className="stat-label">Profile bumps today</div>
        </div>
        <div className="stat-card accent-blue">
          <div className="stat-value">{today.fresh_jobs ?? 0}</div>
          <div className="stat-label">Fresh jobs today</div>
        </div>
        <div className="stat-card accent-green">
          <div className="stat-value">{today.applied ?? 0}</div>
          <div className="stat-label">Applied today</div>
        </div>
        <div className="stat-card accent-orange">
          <div className="stat-value">{today.skipped ?? 0}</div>
          <div className="stat-label">Skipped</div>
        </div>
        <div className="stat-card accent-purple">
          <div className="stat-value">{today.failed ?? 0}</div>
          <div className="stat-label">Apply failed</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatUsd(today.openai_cost_usd)}</div>
          <div className="stat-label">OpenAI spend today</div>
        </div>
      </div>

      <p className="mission-meta">
        Last profile update:{" "}
        {status?.last_profile_updated_at
          ? new Date(status.last_profile_updated_at).toLocaleString()
          : "never"}
        {candidate?.naukri_logged_in === false ? " · Naukri session missing" : ""}
      </p>

      <div className="mission-split">
        <div>
          <h3>Live activity</h3>
          <ActivityFeed events={status?.events || []} />
        </div>
        <div>
          <h3>Today’s applications</h3>
          {(status?.applications || []).length === 0 ? (
            <p className="empty feed-empty">No applications yet today.</p>
          ) : (
            <ul className="apply-list">
              {(status.applications || []).map((app) => (
                <li key={app._id}>
                  <span className={`badge apply-${app.status}`}>{app.status}</span>
                  <span>
                    {app.job_id?.job_title || "Job"} @ {app.job_id?.company || "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <h3>Top matches</h3>
      <RankedJobCards jobs={status?.ranked_jobs || []} />
    </section>
  );
}

export { formatCountdown };
