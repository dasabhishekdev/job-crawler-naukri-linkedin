import { useState } from "react";
import { api } from "./api";
import { getVncBaseUrl } from "./urls";
import { MissionControl } from "./MissionControl";

const VNC_URL = getVncBaseUrl();

const PLATFORM_META = {
  naukri: {
    label: "Naukri",
    kicker: "Live crawl",
    accent: "platform-naukri",
    generateLabel: "Generate Naukri keywords with AI",
    loginLabel: "Open Naukri Login",
    saveLabel: "Save Naukri Session",
    crawlLabel: "Live Crawl Naukri",
    hint: "Log in, generate Naukri-only keywords, then watch the live crawl in the browser below.",
  },
  linkedin: {
    label: "LinkedIn",
    kicker: "Live crawl",
    accent: "platform-linkedin",
    generateLabel: "Generate LinkedIn keywords with AI",
    loginLabel: "Open LinkedIn Login",
    saveLabel: "Save LinkedIn Session",
    crawlLabel: "Live Crawl LinkedIn",
    hint: "Log in, generate LinkedIn-only keywords, then watch the live crawl in the browser below.",
  },
};

function SessionBadge({ active, label }) {
  return (
    <span className={`session-badge ${active ? "active" : "inactive"}`}>
      {active ? "●" : "○"} {label}
    </span>
  );
}

function StatCard({ label, value, accent }) {
  return (
    <div className={`stat-card ${accent || ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function JobsTable({ jobs }) {
  if (!jobs.length) {
    return <p className="empty">No jobs found. Run a crawl to get started.</p>;
  }

  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Title</th>
            <th>Company</th>
            <th>Posted</th>
            <th>Scraped</th>
            <th>Score</th>
            <th>AI</th>
            <th>Tier</th>
            <th>Status</th>
            <th>Session</th>
            <th>Apply</th>
            <th>Link</th>
          </tr>
        </thead>
        <tbody>
          {jobs.map((job) => (
            <tr key={job._id}>
              <td className="title-cell">{job.job_title}</td>
              <td>{job.company}</td>
              <td>
                <span className={`badge freshness-${job.freshness}`}>
                  {job.posted || job.posted_text || "—"}
                </span>
              </td>
              <td>
                {job.scraped_at ? new Date(job.scraped_at).toLocaleString() : "—"}
              </td>
              <td>{job.match_score}</td>
              <td>{job.ai_match_score ?? "—"}</td>
              <td>{job.tier ?? "—"}</td>
              <td>
                <span className={`badge status-${job.url_status}`}>{job.url_status}</span>
              </td>
              <td title={job.crawl_run_id || ""}>
                {job.crawl_run_id ? `…${String(job.crawl_run_id).slice(-6)}` : "—"}
              </td>
              <td>
                <span className={`badge apply-${job.application_status}`}>
                  {job.application_status}
                </span>
              </td>
              <td>
                <a href={job.job_url} target="_blank" rel="noreferrer">
                  Open
                </a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlatformLiveStats({ progress, platform }) {
  if (!progress) return null;
  const target = progress.target_fresh_jobs ?? 20;
  const perKw = progress.fresh_per_keyword_threshold ?? 5;
  const isNaukri = platform === "naukri";
  const query = isNaukri ? progress.naukri_current_query : progress.linkedin_current_query;
  const freshFromQuery = isNaukri
    ? progress.naukri_fresh_from_query ?? 0
    : progress.linkedin_fresh_from_query ?? 0;
  const fetched = isNaukri ? progress.naukri_count ?? 0 : progress.linkedin_count ?? 0;
  const sourceRaw = isNaukri ? progress.naukri_keyword_source : progress.linkedin_keyword_source;
  const sourceLabel = sourceRaw === "ai" ? "AI" : sourceRaw === "fallback" ? "fallback" : sourceRaw === "selected" ? "selected" : "";
  const runSource = progress.source || "all";
  const thisPlatformActive = runSource === "all" || runSource === platform;

  return (
    <div className="live-crawl-stats">
      <div className="live-stat live-stat-primary">
        <span className="live-stat-value">
          {progress.fresh_count ?? progress.fresh_found ?? 0} / {target}
        </span>
        <span className="live-stat-label">Fresh jobs (run target)</span>
      </div>
      <div className="live-stat live-stat-query-box">
        <span className="live-stat-label">
          {isNaukri ? "Naukri" : "LinkedIn"} query{" "}
          {sourceLabel && <span className="query-source">{sourceLabel}</span>}
        </span>
        <span className="live-stat-query">{thisPlatformActive ? query || "—" : "Other platform is crawling"}</span>
        <span className="live-stat-sub">
          {freshFromQuery}/{perKw} fresh on this query
        </span>
      </div>
      <div className="live-stat">
        <span className="live-stat-value">{fetched}</span>
        <span className="live-stat-label">{isNaukri ? "Naukri" : "LinkedIn"} fetched</span>
      </div>
    </div>
  );
}

function PlatformKeywords({
  platform,
  activeResume,
  onResumeChange,
  targetFreshJobs,
  setTargetFreshJobs,
  freshPerKeyword,
  setFreshPerKeyword,
  keywordMode,
  setKeywordMode,
  keywords,
  selectedIds,
  setSelectedIds,
  onReloadKeywords,
  busy,
  setBusy,
  message,
  setMessage,
}) {
  const [manualText, setManualText] = useState("");
  const meta = PLATFORM_META[platform];
  const platformKeywords = keywords.filter(
    (k) => k.active !== false && (k.platform === platform || k.platform === "both")
  );
  const selectedOnPlatform = platformKeywords.filter((k) => selectedIds.includes(k._id)).length;

  function toggleKeyword(id) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  async function handleUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const res = await api.uploadResume(file);
      setMessage(`Uploaded ${res.filename} (${res.text_length} chars extracted)`);
      onResumeChange();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  async function handleGenerate() {
    setBusy(true);
    setMessage("");
    try {
      const data = await api.generateKeywords(targetFreshJobs, freshPerKeyword, platform);
      await onReloadKeywords();
      const newIds = (data.keywords || [])
        .filter((k) => k.platform === platform || k.platform === "both")
        .map((k) => k._id);
      setSelectedIds((prev) => [...new Set([...prev, ...newIds])]);
      const saved = data[platform]?.saved || newIds.length;
      setMessage(`AI saved ${saved} ${meta.label} keywords. The other platform was not changed.`);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddManual(e) {
    e.preventDefault();
    if (!manualText.trim()) return;
    setBusy(true);
    setMessage("");
    try {
      const { keyword } = await api.addKeyword(manualText.trim(), platform);
      await onReloadKeywords();
      setSelectedIds((prev) => [...new Set([...prev, keyword._id])]);
      setManualText("");
      setMessage(`Added ${meta.label} keyword: ${keyword.text}`);
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(id) {
    setBusy(true);
    try {
      await api.deleteKeyword(id);
      setSelectedIds((prev) => prev.filter((x) => x !== id));
      await onReloadKeywords();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="search-settings platform-keywords">
      <h2>{meta.label} keywords</h2>
      <p className="settings-hint">
        AI generate, add, and select keywords for {meta.label} only. The other platform is left untouched.
      </p>
      <div className="settings-row">
        <label className="upload-label">
          <span>Resume (PDF, DOCX, MD, TXT)</span>
          <input
            type="file"
            accept=".pdf,.docx,.md,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            disabled={busy}
            onChange={handleUpload}
          />
        </label>
        <label className="threshold-label">
          Total fresh jobs target
          <input
            type="number"
            min={5}
            max={100}
            value={targetFreshJobs}
            disabled={busy}
            onChange={(e) =>
              setTargetFreshJobs(Math.min(100, Math.max(5, Number(e.target.value) || 20)))
            }
          />
        </label>
        <label className="threshold-label">
          Fresh jobs per keyword
          <input
            type="number"
            min={5}
            max={10}
            value={freshPerKeyword}
            disabled={busy}
            onChange={(e) =>
              setFreshPerKeyword(Math.min(10, Math.max(5, Number(e.target.value) || 8)))
            }
          />
        </label>
        <button type="button" className="secondary" disabled={busy} onClick={handleGenerate}>
          {meta.generateLabel}
        </button>
      </div>

      <div className="keyword-mode-row">
        <span className="mode-label">Crawl mode</span>
        <label className="mode-option">
          <input
            type="radio"
            name={`${platform}-keywordMode`}
            checked={keywordMode === "selected_only"}
            onChange={() => setKeywordMode("selected_only")}
          />
          Selected only
        </label>
        <label className="mode-option">
          <input
            type="radio"
            name={`${platform}-keywordMode`}
            checked={keywordMode === "selected_plus_ai"}
            onChange={() => setKeywordMode("selected_plus_ai")}
          />
          Selected + AI top-up
        </label>
        <label className="mode-option">
          <input
            type="radio"
            name={`${platform}-keywordMode`}
            checked={keywordMode === "ai_auto"}
            onChange={() => setKeywordMode("ai_auto")}
          />
          AI auto (no selection required)
        </label>
      </div>

      <form className="manual-keyword-row" onSubmit={handleAddManual}>
        <input
          type="text"
          placeholder={`Add ${meta.label} keyword…`}
          value={manualText}
          disabled={busy}
          aria-label={`Add ${meta.label} keyword`}
          onChange={(e) => setManualText(e.target.value)}
        />
        <button type="submit" disabled={busy || !manualText.trim()}>
          Add
        </button>
      </form>

      <div className="keyword-library keyword-library-single">
        <div className="keyword-platform-block">
          <div className="keyword-platform-header">
            <strong>{meta.label} library</strong>
            <button
              type="button"
              className="linkish"
              onClick={() =>
                setSelectedIds((prev) => [
                  ...new Set([...prev, ...platformKeywords.map((k) => k._id)]),
                ])
              }
            >
              Select all
            </button>
          </div>
          {platformKeywords.length === 0 ? (
            <p className="keyword-empty">No {meta.label} keywords yet.</p>
          ) : (
            <div className="keyword-chips">
              {platformKeywords.map((k) => {
                const selected = selectedIds.includes(k._id);
                return (
                  <button
                    key={k._id}
                    type="button"
                    className={`keyword-chip ${selected ? "selected" : ""} source-${k.source}`}
                    onClick={() => toggleKeyword(k._id)}
                    title={`${k.source} · click to ${selected ? "deselect" : "select"}`}
                  >
                    <span>{k.text}</span>
                    <span
                      className="chip-remove"
                      role="button"
                      tabIndex={0}
                      aria-label={`Remove ${k.text}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemove(k._id);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          e.stopPropagation();
                          handleRemove(k._id);
                        }
                      }}
                    >
                      ×
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="settings-status">
        {activeResume?.active ? (
          <span className="resume-active">
            Active resume: <strong>{activeResume.filename}</strong>
          </span>
        ) : (
          <span className="resume-missing">No resume uploaded — required before crawl</span>
        )}
        <span className="selected-count">
          {selectedOnPlatform} {meta.label} keyword{selectedOnPlatform === 1 ? "" : "s"} selected
        </span>
      </div>
      {message && <p className="settings-message">{message}</p>}
    </section>
  );
}

function PlatformBrowser({
  platform,
  authStatus,
  onRefresh,
  busy,
  setBusy,
  message,
  setMessage,
  crawlRunning,
  crawlProgress,
  onStopCrawl,
  stopping,
  thisPlatformCrawling,
}) {
  const meta = PLATFORM_META[platform];
  const loggedIn = Boolean(authStatus?.[platform]?.logged_in);

  async function handleOpen() {
    setBusy(true);
    setMessage("");
    try {
      const res = await api.openAuthLogin(platform);
      setMessage(res.message);
      onRefresh();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    setBusy(true);
    setMessage("");
    try {
      const res = await api.saveAuthSession(platform);
      setMessage(res.message);
      onRefresh();
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  const vncUrl = authStatus?.vnc_url || VNC_URL;

  return (
    <section className="browser-login platform-browser">
      <div className="section-heading">
        <h2>{meta.label} browser (noVNC)</h2>
        <p className="settings-hint">{meta.hint}</p>
      </div>
      <div className="browser-toolbar">
        <div className="browser-status">
          <SessionBadge active={loggedIn} label={`${meta.label} session`} />
          {authStatus?.current_platform === platform && (
            <span className="browser-active">Browser: {platform}</span>
          )}
          {authStatus?.auth_browser_available === false && (
            <span className="browser-warning">Auth browser offline</span>
          )}
        </div>
        <div className="browser-actions">
          <button type="button" disabled={busy} onClick={handleOpen}>
            {meta.loginLabel}
          </button>
          <button type="button" disabled={busy} className="secondary" onClick={handleSave}>
            {meta.saveLabel}
          </button>
          <a className="vnc-link-btn" href={vncUrl} target="_blank" rel="noreferrer">
            Open VNC in new tab
          </a>
        </div>
      </div>

      {authStatus?.auth_browser_available === false && (
        <p className="browser-error">
          Auth browser is not running. Run: <code>docker compose up -d auth-browser</code>
          {authStatus.error ? ` — ${authStatus.error}` : ""}
        </p>
      )}

      {message && <p className="browser-message">{message}</p>}

      {crawlRunning && (
        <div className="crawl-live-banner">
          <span className="crawl-pulse" />
          {thisPlatformCrawling
            ? `Live ${meta.label} crawl — stops at ${crawlProgress?.target_fresh_jobs ?? 20} fresh jobs`
            : `A crawl is running on the other platform`}
          <button
            type="button"
            className="btn-stop"
            disabled={stopping}
            onClick={onStopCrawl}
          >
            {stopping ? "Cancelling…" : "Cancel Search"}
          </button>
        </div>
      )}

      {thisPlatformCrawling && <PlatformLiveStats progress={crawlProgress} platform={platform} />}

      <div className="vnc-frame-wrap">
        <iframe
          title={`${meta.label} Playwright browser`}
          src={vncUrl}
          className="vnc-frame"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </section>
  );
}

function PlatformLogs({ logs, platform }) {
  const filtered = (logs || []).filter((log) => {
    const source = String(log.source || "").toLowerCase();
    if (platform === "naukri") return source === "naukri" || source === "agent" || source === "worker";
    return source === "linkedin" || source === "worker";
  });

  return (
    <section className="logs-panel platform-logs">
      <h2>{PLATFORM_META[platform].label} live logs</h2>
      <div className="log-stream">
        {filtered.length === 0 ? (
          <p className="empty">No {PLATFORM_META[platform].label} logs yet.</p>
        ) : (
          filtered.map((log) => (
            <div key={log._id || `${log.created_at}-${log.message}`} className={`log-line log-${log.level}`}>
              <span className="log-time">
                {new Date(log.created_at).toLocaleTimeString()}
              </span>
              <span className="log-source">[{log.source || "worker"}]</span>
              <span>{log.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function PlatformWorkspace({
  platform,
  stats,
  jobs,
  loading,
  runs,
  filter,
  setFilter,
  onRefreshJobs,
  onExport,
  logs,
  authStatus,
  onRefreshAuth,
  authBusy,
  setAuthBusy,
  authMessage,
  setAuthMessage,
  crawlActive,
  crawlProgress,
  crawlSource,
  crawling,
  stopping,
  onStopCrawl,
  onLiveCrawl,
  onBackgroundCrawl,
  activeResume,
  onResumeChange,
  targetFreshJobs,
  setTargetFreshJobs,
  freshPerKeyword,
  setFreshPerKeyword,
  keywordMode,
  setKeywordMode,
  keywords,
  selectedIds,
  setSelectedIds,
  onReloadKeywords,
  settingsBusy,
  setSettingsBusy,
  settingsMessage,
  setSettingsMessage,
  agentStatus,
  agentStarting,
  onRunAgent,
  onOpenSettings,
}) {
  const meta = PLATFORM_META[platform];
  const thisPlatformCrawling =
    crawlActive && (!crawlSource || crawlSource === "all" || crawlSource === platform);
  const platformRuns = (runs || []).filter((run) => run.source === platform || run.source === "all");
  const jobCount = platform === "naukri" ? stats?.naukriJobs : stats?.linkedinJobs;

  return (
    <section className={`platform-workspace ${meta.accent}`}>
      <header className="platform-hero">
        <div>
          <p className="mission-kicker">{meta.kicker}</p>
          <h2>{meta.label}</h2>
          <p className="mission-now">{meta.hint}</p>
        </div>
        <div className="mission-actions">
          <button
            type="button"
            disabled={crawlActive || crawling}
            onClick={onLiveCrawl}
          >
            {crawling ? "Starting…" : meta.crawlLabel}
          </button>
          <button
            type="button"
            className="secondary"
            disabled={crawlActive || crawling}
            onClick={onBackgroundCrawl}
          >
            Background
          </button>
          {crawlActive && (
            <button type="button" className="btn-stop" disabled={stopping} onClick={onStopCrawl}>
              {stopping ? "Cancelling…" : "Cancel Search"}
            </button>
          )}
        </div>
      </header>

      {platform === "naukri" && (
        <MissionControl
          status={agentStatus}
          stopping={stopping}
          crawling={crawling || agentStarting}
          onRunAgent={onRunAgent}
          onStop={onStopCrawl}
          onOpenSettings={onOpenSettings}
        />
      )}

      {stats && (
        <div className="stats-grid stats-grid-platform">
          <StatCard label={`${meta.label} jobs`} value={jobCount ?? 0} accent={platform === "naukri" ? "accent-green" : "accent-purple"} />
          <StatCard label="Valid Open" value={stats.validOpen} accent="accent-teal" />
          <StatCard label="Applied" value={stats.applied} accent="accent-orange" />
          <StatCard label="Applied today" value={stats.appliedToday ?? 0} accent="accent-green" />
        </div>
      )}

      <PlatformKeywords
        platform={platform}
        activeResume={activeResume}
        onResumeChange={onResumeChange}
        targetFreshJobs={targetFreshJobs}
        setTargetFreshJobs={setTargetFreshJobs}
        freshPerKeyword={freshPerKeyword}
        setFreshPerKeyword={setFreshPerKeyword}
        keywordMode={keywordMode}
        setKeywordMode={setKeywordMode}
        keywords={keywords}
        selectedIds={selectedIds}
        setSelectedIds={setSelectedIds}
        onReloadKeywords={onReloadKeywords}
        busy={settingsBusy}
        setBusy={setSettingsBusy}
        message={settingsMessage}
        setMessage={setSettingsMessage}
      />

      <PlatformBrowser
        platform={platform}
        authStatus={authStatus}
        onRefresh={onRefreshAuth}
        busy={authBusy}
        setBusy={setAuthBusy}
        message={authMessage}
        setMessage={setAuthMessage}
        crawlRunning={crawlActive}
        crawlProgress={crawlProgress}
        onStopCrawl={onStopCrawl}
        stopping={stopping}
        thisPlatformCrawling={thisPlatformCrawling}
      />

      <section className="platform-jobs">
        <h2>{meta.label} jobs</h2>
        <div className="filters">
          <input
            placeholder="Search title, company…"
            value={filter.q}
            aria-label={`Search ${meta.label} jobs`}
            onChange={(e) => setFilter({ ...filter, q: e.target.value })}
          />
          <select
            value={filter.crawl_run_id}
            aria-label="Filter by session"
            onChange={(e) => setFilter({ ...filter, crawl_run_id: e.target.value })}
          >
            <option value="">All sessions</option>
            {platformRuns.map((run) => (
              <option key={run._id} value={run._id}>
                {new Date(run.started_at).toLocaleString()} · {run.source} · …
                {String(run._id).slice(-6)}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={filter.from}
            onChange={(e) => setFilter({ ...filter, from: e.target.value })}
            title="From date"
          />
          <input
            type="date"
            value={filter.to}
            onChange={(e) => setFilter({ ...filter, to: e.target.value })}
            title="To date"
          />
          <select
            value={filter.url_status}
            aria-label="Filter by status"
            onChange={(e) => setFilter({ ...filter, url_status: e.target.value })}
          >
            <option value="">All statuses</option>
            <option value="valid_open">Valid open</option>
            <option value="valid_closed">Closed</option>
            <option value="discovered">Discovered</option>
            <option value="dead">Dead</option>
          </select>
          <select
            value={filter.freshness}
            aria-label="Filter by freshness"
            onChange={(e) => setFilter({ ...filter, freshness: e.target.value })}
          >
            <option value="">All freshness</option>
            <option value="fresh">Fresh</option>
            <option value="stale">Stale</option>
            <option value="unknown">Unknown</option>
          </select>
          <select
            value={filter.tier}
            aria-label="Filter by tier"
            onChange={(e) => setFilter({ ...filter, tier: e.target.value })}
          >
            <option value="">All tiers</option>
            <option value="1">Tier 1</option>
            <option value="2">Tier 2</option>
          </select>
          <button type="button" onClick={onRefreshJobs}>
            Refresh
          </button>
          <button type="button" className="secondary" onClick={onExport}>
            Export filtered
          </button>
        </div>
        {loading ? <p className="empty">Loading…</p> : <JobsTable jobs={jobs} />}
      </section>

      <PlatformLogs logs={logs} platform={platform} />
    </section>
  );
}
