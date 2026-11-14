import { useCallback, useEffect, useState } from "react";
import { api } from "./api";

const STAGE_LABELS = {
  discover: "Searching the web and career pages",
  score: "Scoring jobs against the resume",
  tailor: "Writing tailored resumes",
  sync: "Updating the Google Sheet",
  done: "Finished",
};

function formatTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

function ScorePill({ value, good = 70, ok = 50 }) {
  if (value === null || value === undefined) return <span className="score-pill">—</span>;
  const tone = value >= good ? "good" : value >= ok ? "ok" : "low";
  return <span className={`score-pill score-${tone}`}>{value}%</span>;
}

function Toggle({ checked, onChange, label, disabled }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
      <span>{label}</span>
    </label>
  );
}

function RunPanel({ status, onRun, onStop, busy }) {
  const run = status?.run;
  const running = status?.running;
  return (
    <section className="multi-panel">
      <div className="multi-panel-head">
        <h3>Latest run</h3>
        <div className="mission-actions">
          {running ? (
            <button type="button" className="btn-stop" disabled={busy} onClick={onStop}>
              Stop run
            </button>
          ) : (
            <button type="button" disabled={busy} onClick={onRun}>
              Run now
            </button>
          )}
        </div>
      </div>
      {run ? (
        <>
          <p className="multi-run-line">
            <span className={`badge run-${run.status}`}>{run.status}</span>
            {running && run.multi_stage ? ` ${STAGE_LABELS[run.multi_stage] || run.multi_stage}` : ""}
            {running && run.current_job_title ? ` — ${run.current_job_title}` : ""}
            {!running ? ` ${formatTime(run.finished_at || run.started_at)}` : ""}
          </p>
          <div className="multi-counters">
            <span><strong>{run.web_fetched || 0}</strong> web</span>
            <span><strong>{run.career_fetched || 0}</strong> career pages</span>
            <span><strong>{run.new_jobs || 0}</strong> new</span>
            <span><strong>{run.scored || 0}</strong> scored</span>
            <span><strong>{run.relevant || 0}</strong> relevant</span>
            <span><strong>{run.tailored_count || 0}</strong> resumes</span>
          </div>
          {run.error_message ? <p className="settings-error">{run.error_message}</p> : null}
        </>
      ) : (
        <p className="settings-hint">No all-sources run yet. Click Run now to start the first one.</p>
      )}
      <div className="log-stream multi-log">
        {(status?.logs || []).length === 0 ? (
          <p className="empty">Run logs appear here.</p>
        ) : (
          status.logs.map((log) => (
            <div key={log._id} className={`log-line log-${log.level}`}>
              <span className="log-time">{new Date(log.created_at).toLocaleTimeString()}</span> {log.message}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function CareerPagesEditor({ pages, onSave }) {
  const [rows, setRows] = useState(pages);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => setRows(pages), [pages]);

  async function persist(next) {
    setRows(next);
    try {
      await onSave(next);
      setMessage("Saved");
    } catch (err) {
      setMessage(err.message);
    }
  }

  function handleAdd(e) {
    e.preventDefault();
    if (!/^https?:\/\//i.test(url.trim())) {
      setMessage("Enter a full careers URL starting with https://");
      return;
    }
    persist([...rows, { name: name.trim(), url: url.trim(), enabled: true }]);
    setName("");
    setUrl("");
  }

  return (
    <section className="multi-panel">
      <div className="multi-panel-head">
        <h3>Target company career pages</h3>
      </div>
      <p className="settings-hint">
        Greenhouse, Lever and Ashby boards are read directly. Any other careers page is opened by the web agent.
      </p>
      <ul className="career-list">
        {rows.map((page, i) => (
          <li key={`${page.url}-${i}`}>
            <Toggle
              checked={page.enabled !== false}
              label={page.name || page.url}
              onChange={(checked) => persist(rows.map((p, j) => (j === i ? { ...p, enabled: checked } : p)))}
            />
            <a href={page.url} target="_blank" rel="noreferrer" className="career-url">
              {page.url}
            </a>
            <span className="career-meta">
              {page.last_error ? (
                <span className="settings-error" title={page.last_error}>error</span>
              ) : page.last_crawled_at ? (
                `${page.last_found || 0} found`
              ) : (
                "not crawled yet"
              )}
            </span>
            <button type="button" className="linkish" onClick={() => persist(rows.filter((_, j) => j !== i))}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <form className="career-add" onSubmit={handleAdd}>
        <input placeholder="Company" value={name} onChange={(e) => setName(e.target.value)} aria-label="Company name" />
        <input
          placeholder="https://company.com/careers"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          aria-label="Careers page URL"
        />
        <button type="submit" className="secondary">Add</button>
      </form>
      {message ? <p className="settings-hint">{message}</p> : null}
    </section>
  );
}

function JobsList({ jobs, onTailor }) {
  if (!jobs.length) return <p className="empty">No jobs yet. The first run fills this list.</p>;
  return (
    <div className="table-wrap">
      <table className="multi-jobs">
        <thead>
          <tr>
            <th>Added</th>
            <th>Match</th>
            <th>ATS</th>
            <th>Job</th>
            <th>Summary</th>
            <th>Source</th>
            <th>Links</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job._id}>
              <td className="nowrap">{formatTime(job.first_seen_at || job.createdAt)}</td>
              <td>
                <ScorePill value={job.fit_score ?? job.ai_match_score} />
                {job.relevancy ? <div className={`relevancy relevancy-${job.relevancy.toLowerCase()}`}>{job.relevancy}</div> : null}
              </td>
              <td>
                <ScorePill value={job.ats_score} good={75} ok={55} />
                {job.tailored?.ats_score ? <div className="ats-after">→ {job.tailored.ats_score}%</div> : null}
              </td>
              <td className="title-cell">
                <div>{job.job_title}</div>
                <div className="job-company">{job.company} · {job.location || "Bengaluru"}</div>
              </td>
              <td className="summary-cell" title={(job.ats_missing || []).length ? `Missing: ${job.ats_missing.join(", ")}` : ""}>
                {job.summary || job.ai_match_reason || "Not scored yet"}
              </td>
              <td className="nowrap">{job.source_site || job.source}</td>
              <td className="links-cell">
                <a href={job.external_apply_url || job.job_url} target="_blank" rel="noreferrer">Apply</a>
                {job.tailored?.drive_url ? (
                  <a href={job.tailored.drive_url} target="_blank" rel="noreferrer">Resume</a>
                ) : job.tailored?.status === "pending" ? (
                  <span className="muted">queued</span>
                ) : job.fit_score !== null && job.fit_score !== undefined ? (
                  <button type="button" className="linkish" onClick={() => onTailor(job._id)} title={job.tailored?.error || ""}>
                    {job.tailored?.status === "failed" ? "Retry resume" : "Tailor"}
                  </button>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function AllSources({ candidateName }) {
  const [status, setStatus] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [total, setTotal] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState({ q: "", min_fit: "", relevancy: "", scope: "all" });

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await api.getMultiStatus());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    try {
      const data = await api.getMultiJobs({ ...filter, limit: 300 });
      setJobs(data.jobs || []);
      setTotal(data.total || 0);
    } catch (err) {
      setError(err.message);
    }
  }, [filter]);

  useEffect(() => {
    loadStatus();
    const interval = setInterval(loadStatus, 4000);
    return () => clearInterval(interval);
  }, [loadStatus]);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 15000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await loadStatus();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const settings = status?.settings;
  const google = status?.google;
  const engines = status?.engines || {};

  return (
    <div className="mission-control">
      <header className="platform-hero">
        <div>
          <p className="mission-kicker">All sources</p>
          <h2>Any-site job search for {candidateName || "the selected profile"}</h2>
          <p className="mission-now">
            {settings?.hourly_enabled
              ? `Hourly crawling is on. Next run ${formatTime(status?.next_run_at)}.`
              : "Hourly crawling is off. Turn it on or click Run now."}{" "}
            Location: {settings?.location || "Bengaluru"}.
          </p>
        </div>
        <div className="mission-actions">
          {status?.candidate?.sheet_url ? (
            <a className="vnc-link-btn" href={status.candidate.sheet_url} target="_blank" rel="noreferrer">
              Open Google Sheet
            </a>
          ) : null}
          <Toggle
            checked={Boolean(settings?.hourly_enabled)}
            disabled={!settings || busy}
            label="Crawl every hour"
            onChange={(checked) => act(() => api.saveMultiSettings({ hourly_enabled: checked }))}
          />
        </div>
      </header>

      <div className="multi-chips">
        <span className={`settings-status-chip ${engines.cursor ? "ok" : "warn"}`}>
          {engines.cursor ? "Cursor web agent ready" : "CURSOR_API_KEY missing"}
        </span>
        <span className={`settings-status-chip ${engines.openai || engines.cursor ? "ok" : "warn"}`}>
          Scoring: {engines.openai ? "OpenAI" : engines.cursor ? "Cursor" : "not configured"}
        </span>
        <span className={`settings-status-chip ${google?.connected ? "ok" : "warn"}`}>
          {google?.connected ? `Drive: ${google.email || "connected"}` : "Google Drive not connected (Settings)"}
        </span>
        {settings ? (
          <>
            <Toggle
              checked={settings.sources.web_agent}
              disabled={busy}
              label="Web agent"
              onChange={(checked) => act(() => api.saveMultiSettings({ sources: { web_agent: checked } }))}
            />
            <Toggle
              checked={settings.sources.career_pages}
              disabled={busy}
              label="Career pages"
              onChange={(checked) => act(() => api.saveMultiSettings({ sources: { career_pages: checked } }))}
            />
          </>
        ) : null}
      </div>
      {error ? <p className="settings-error">{error}</p> : null}

      <div className="multi-grid">
        <RunPanel
          status={status}
          busy={busy}
          onRun={() => act(() => api.runMulti())}
          onStop={() => act(() => api.stopMulti())}
        />
        <CareerPagesEditor
          pages={status?.candidate?.career_pages || []}
          onSave={async (pages) => {
            await api.saveCareerPages(pages);
            await loadStatus();
          }}
        />
      </div>

      {settings ? (
        <p className="settings-hint">
          Jobs at {settings.min_fit_to_sync}%+ match go to the sheet. A tailored resume is written when match is{" "}
          {settings.tailor_min_fit}%+ and ATS is under {settings.tailor_max_ats}%.
        </p>
      ) : null}

      <section className="platform-jobs">
        <div className="filters">
          <input
            placeholder="Search title, company, summary"
            value={filter.q}
            onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))}
          />
          <select value={filter.min_fit} onChange={(e) => setFilter((f) => ({ ...f, min_fit: e.target.value }))}>
            <option value="">Any match</option>
            <option value="50">50%+ match</option>
            <option value="70">70%+ match</option>
            <option value="85">85%+ match</option>
          </select>
          <select value={filter.relevancy} onChange={(e) => setFilter((f) => ({ ...f, relevancy: e.target.value }))}>
            <option value="">Any relevancy</option>
            <option value="High">High</option>
            <option value="Medium">Medium</option>
            <option value="Low">Low</option>
          </select>
          <select value={filter.scope} onChange={(e) => setFilter((f) => ({ ...f, scope: e.target.value }))}>
            <option value="all">All scored sources</option>
            <option value="multi">Web and career pages only</option>
          </select>
          <span className="settings-hint">{total} jobs, newest first</span>
        </div>
        <JobsList
          jobs={jobs}
          onTailor={async (id) => {
            try {
              await api.tailorJob(id);
              await loadJobs();
            } catch (err) {
              setError(err.message);
            }
          }}
        />
      </section>
    </div>
  );
}
