import { useEffect, useState, useCallback } from "react";
import { api } from "./api";
import { getVncBaseUrl } from "./urls";

const VNC_URL = getVncBaseUrl();

const TABS = [
  { id: "dashboard", label: "Dashboard" },
  { id: "browser", label: "Browser Login" },
  { id: "naukri", label: "Naukri", source: "naukri" },
  { id: "linkedin", label: "LinkedIn", source: "linkedin" },
  { id: "logs", label: "Live Logs" },
];

function StatCard({ label, value, accent }) {
  return (
    <div className={`stat-card ${accent || ""}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  );
}

function SessionBadge({ active, label }) {
  return (
    <span className={`session-badge ${active ? "active" : "inactive"}`}>
      {active ? "●" : "○"} {label}
    </span>
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

function LiveCrawlStats({ progress }) {
  if (!progress) return null;
  const target = progress.target_fresh_jobs ?? 20;
  const fresh = progress.fresh_count ?? progress.fresh_found ?? 0;
  const perKw = progress.fresh_per_keyword_threshold ?? 5;
  const naukriSource = progress.naukri_keyword_source === "ai" ? "AI" : progress.naukri_keyword_source === "fallback" ? "fallback" : "";
  const linkedinSource = progress.linkedin_keyword_source === "ai" ? "AI" : progress.linkedin_keyword_source === "fallback" ? "fallback" : "";
  return (
    <div className="live-crawl-stats">
      <div className="live-stat live-stat-primary">
        <span className="live-stat-value">
          {fresh} / {target}
        </span>
        <span className="live-stat-label">Fresh jobs (run target)</span>
      </div>
      <div className="live-stat live-stat-query-box">
        <span className="live-stat-label">
          Naukri query {naukriSource && <span className="query-source">{naukriSource}</span>}
        </span>
        <span className="live-stat-query">{progress.naukri_current_query || "—"}</span>
        <span className="live-stat-sub">
          {progress.naukri_fresh_from_query ?? 0}/{perKw} fresh
        </span>
      </div>
      <div className="live-stat live-stat-query-box">
        <span className="live-stat-label">
          LinkedIn query {linkedinSource && <span className="query-source">{linkedinSource}</span>}
        </span>
        <span className="live-stat-query">{progress.linkedin_current_query || "—"}</span>
        <span className="live-stat-sub">
          {progress.linkedin_fresh_from_query ?? 0}/{perKw} fresh
        </span>
      </div>
      <div className="live-stat">
        <span className="live-stat-value">{progress.naukri_count ?? 0}</span>
        <span className="live-stat-label">Naukri fetched</span>
      </div>
      <div className="live-stat">
        <span className="live-stat-value">{progress.linkedin_count ?? 0}</span>
        <span className="live-stat-label">LinkedIn fetched</span>
      </div>
    </div>
  );
}

function SearchSettingsPanel({
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
  crawlActive,
  crawlProgress,
  onCancelSearch,
  stopping,
}) {
  const [manualText, setManualText] = useState("");
  const [manualPlatform, setManualPlatform] = useState("naukri");

  const naukriKeywords = keywords.filter(
    (k) => k.active !== false && (k.platform === "naukri" || k.platform === "both")
  );
  const linkedinKeywords = keywords.filter(
    (k) => k.active !== false && (k.platform === "linkedin" || k.platform === "both")
  );

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
      const data = await api.generateKeywords(targetFreshJobs, freshPerKeyword);
      await onReloadKeywords();
      const naukriIds = (data.keywords || [])
        .filter((k) => k.platform === "naukri")
        .map((k) => k._id);
      const linkedinIds = (data.keywords || [])
        .filter((k) => k.platform === "linkedin")
        .map((k) => k._id);
      setSelectedIds((prev) => [...new Set([...prev, ...naukriIds, ...linkedinIds])]);
      setMessage(
        `AI saved ${data.naukri?.saved || 0} Naukri + ${data.linkedin?.saved || 0} LinkedIn keywords to library.`
      );
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
      const { keyword } = await api.addKeyword(manualText.trim(), manualPlatform);
      await onReloadKeywords();
      setSelectedIds((prev) => [...new Set([...prev, keyword._id])]);
      setManualText("");
      setMessage(`Added keyword: ${keyword.text}`);
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

  function renderChips(list, platformLabel) {
    if (!list.length) {
      return <p className="keyword-empty">No {platformLabel} keywords yet.</p>;
    }
    return (
      <div className="keyword-chips">
        {list.map((k) => {
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
                onClick={(e) => {
                  e.stopPropagation();
                  handleRemove(k._id);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
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
    );
  }

  return (
    <section className="search-settings">
      <h2>Search Settings</h2>
      {crawlActive && (
        <div className="crawl-live-banner search-crawl-banner">
          <span className="crawl-pulse" />
          Job search in progress
          {crawlProgress?.status === "queued" ? " (queued)" : ""}
          {crawlProgress?.run_id && (
            <span className="search-crawl-query"> — session {String(crawlProgress.run_id).slice(-8)}</span>
          )}
          {crawlProgress?.naukri_current_query && (
            <span className="search-crawl-query"> — {crawlProgress.naukri_current_query}</span>
          )}
          <button
            type="button"
            className="btn-stop"
            disabled={stopping}
            onClick={onCancelSearch}
          >
            {stopping ? "Cancelling…" : "Cancel Search"}
          </button>
        </div>
      )}
      <p className="settings-hint">
        Build a keyword library (manual + AI), select keywords, choose crawl mode, then start a crawl.
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
          Generate with AI (save)
        </button>
      </div>

      <div className="keyword-mode-row">
        <span className="mode-label">Crawl mode</span>
        <label className="mode-option">
          <input
            type="radio"
            name="keywordMode"
            checked={keywordMode === "selected_only"}
            onChange={() => setKeywordMode("selected_only")}
          />
          Selected only
        </label>
        <label className="mode-option">
          <input
            type="radio"
            name="keywordMode"
            checked={keywordMode === "selected_plus_ai"}
            onChange={() => setKeywordMode("selected_plus_ai")}
          />
          Selected + AI top-up
        </label>
        <label className="mode-option">
          <input
            type="radio"
            name="keywordMode"
            checked={keywordMode === "ai_auto"}
            onChange={() => setKeywordMode("ai_auto")}
          />
          AI auto (no selection required)
        </label>
      </div>

      <form className="manual-keyword-row" onSubmit={handleAddManual}>
        <input
          type="text"
          placeholder="Add keyword manually…"
          value={manualText}
          disabled={busy}
          onChange={(e) => setManualText(e.target.value)}
        />
        <select
          value={manualPlatform}
          disabled={busy}
          onChange={(e) => setManualPlatform(e.target.value)}
        >
          <option value="naukri">Naukri</option>
          <option value="linkedin">LinkedIn</option>
          <option value="both">Both</option>
        </select>
        <button type="submit" disabled={busy || !manualText.trim()}>
          Add
        </button>
      </form>

      <div className="keyword-library">
        <div className="keyword-platform-block">
          <div className="keyword-platform-header">
            <strong>Naukri</strong>
            <button
              type="button"
              className="linkish"
              onClick={() => setSelectedIds(naukriKeywords.map((k) => k._id))}
            >
              Select all
            </button>
          </div>
          {renderChips(naukriKeywords, "Naukri")}
        </div>
        <div className="keyword-platform-block">
          <div className="keyword-platform-header">
            <strong>LinkedIn</strong>
            <button
              type="button"
              className="linkish"
              onClick={() =>
                setSelectedIds((prev) => [
                  ...new Set([...prev, ...linkedinKeywords.map((k) => k._id)]),
                ])
              }
            >
              Select all
            </button>
          </div>
          {renderChips(linkedinKeywords, "LinkedIn")}
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
          {selectedIds.length} keyword{selectedIds.length === 1 ? "" : "s"} selected
        </span>
      </div>
      {message && <p className="settings-message">{message}</p>}
    </section>
  );
}

function BrowserLoginPanel({
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
}) {
  async function handleOpen(platform) {
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

  async function handleSave(platform) {
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
    <section className="browser-login">
      <div className="browser-toolbar">
        <div className="browser-status">
          <SessionBadge
            active={authStatus?.linkedin?.logged_in}
            label="LinkedIn session"
          />
          <SessionBadge
            active={authStatus?.naukri?.logged_in}
            label="Naukri session"
          />
          {authStatus?.current_platform && (
            <span className="browser-active">
              Browser: {authStatus.current_platform}
            </span>
          )}
          {authStatus?.auth_browser_available === false && (
            <span className="browser-warning">Auth browser offline</span>
          )}
        </div>
        <div className="browser-actions">
          <button disabled={busy} onClick={() => handleOpen("linkedin")}>
            Open LinkedIn Login
          </button>
          <button disabled={busy} className="secondary" onClick={() => handleSave("linkedin")}>
            Save LinkedIn Session
          </button>
          <button disabled={busy} onClick={() => handleOpen("naukri")}>
            Open Naukri Login
          </button>
          <button disabled={busy} className="secondary" onClick={() => handleSave("naukri")}>
            Save Naukri Session
          </button>
          <a
            className="vnc-link-btn"
            href={vncUrl}
            target="_blank"
            rel="noreferrer"
          >
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

      <p className="browser-hint">
        {crawlRunning ? (
          <>
            <strong>Live crawl in progress</strong> — Naukri and LinkedIn run in parallel.
            Watch the browser navigate job pages in real time below.
          </>
        ) : (
          <>
            Use the browser below to log in. After signing in, click <strong>Save Session</strong>{" "}
            so crawlers can reuse your login.
          </>
        )}
      </p>

      {crawlRunning && (
        <div className="crawl-live-banner">
          <span className="crawl-pulse" />
          Live crawl — stops at {crawlProgress?.target_fresh_jobs ?? 20} fresh jobs
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

      {crawlRunning && <LiveCrawlStats progress={crawlProgress} />}

      <div className="vnc-frame-wrap">
        <iframe
          title="Playwright Browser"
          src={vncUrl}
          className="vnc-frame"
          allow="clipboard-read; clipboard-write"
        />
      </div>
    </section>
  );
}

export default function App() {
  const [tab, setTab] = useState("dashboard");
  const [stats, setStats] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [logs, setLogs] = useState([]);
  const [filter, setFilter] = useState({
    url_status: "",
    tier: "",
    freshness: "",
    q: "",
    crawl_run_id: "",
    from: "",
    to: "",
  });
  const [loading, setLoading] = useState(false);
  const [crawling, setCrawling] = useState(false);
  const [authStatus, setAuthStatus] = useState(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authMessage, setAuthMessage] = useState("");
  const [liveCrawl, setLiveCrawl] = useState(false);
  const [activeRunId, setActiveRunId] = useState(null);
  const [crawlProgress, setCrawlProgress] = useState(null);
  const [stopping, setStopping] = useState(false);
  const [activeResume, setActiveResume] = useState(null);
  const [freshPerKeyword, setFreshPerKeyword] = useState(8);
  const [targetFreshJobs, setTargetFreshJobs] = useState(20);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState("");
  const [keywordMode, setKeywordMode] = useState("selected_plus_ai");
  const [keywords, setKeywords] = useState([]);
  const [selectedKeywordIds, setSelectedKeywordIds] = useState([]);
  const [runs, setRuns] = useState([]);

  const activeTab = TABS.find((t) => t.id === tab);
  const source = activeTab?.source;

  const loadDashboard = useCallback(async () => {
    const data = await api.getDashboard();
    setStats(data);
  }, []);

  const loadAuthStatus = useCallback(async () => {
    try {
      const data = await api.getAuthStatus();
      setAuthStatus(data);
    } catch {
      setAuthStatus(null);
    }
  }, []);

  const loadActiveResume = useCallback(async () => {
    try {
      const data = await api.getActiveResume();
      setActiveResume(data);
    } catch {
      setActiveResume(null);
    }
  }, []);

  const loadKeywords = useCallback(async () => {
    try {
      const data = await api.listKeywords({ active: "true" });
      setKeywords(data.keywords || []);
    } catch {
      setKeywords([]);
    }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const data = await api.getRuns(50);
      setRuns(data.runs || []);
    } catch {
      setRuns([]);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    try {
      const params = { limit: 200, sort: "-scraped_at" };
      if (source) params.source = source;
      if (filter.url_status) params.url_status = filter.url_status;
      if (filter.freshness) params.freshness = filter.freshness;
      if (filter.tier) params.tier = filter.tier;
      if (filter.q) params.q = filter.q;
      if (filter.crawl_run_id) params.crawl_run_id = filter.crawl_run_id;
      if (filter.from) params.from = filter.from;
      if (filter.to) params.to = filter.to;
      const data = await api.getJobs(params);
      setJobs(data.jobs);
    } finally {
      setLoading(false);
    }
  }, [source, filter]);

  function selectedQueriesForPlatform(platform) {
    return keywords
      .filter((k) => {
        if (!selectedKeywordIds.includes(k._id)) return false;
        return k.platform === platform || k.platform === "both";
      })
      .map((k) => k.text);
  }

  function exportParams() {
    const params = {};
    if (source) params.source = source;
    if (filter.url_status) params.url_status = filter.url_status;
    if (filter.freshness) params.freshness = filter.freshness;
    if (filter.tier) params.tier = filter.tier;
    if (filter.crawl_run_id) params.crawl_run_id = filter.crawl_run_id;
    if (filter.from) params.from = filter.from;
    if (filter.to) params.to = filter.to;
    return params;
  }

  const loadLogs = useCallback(async () => {
    const data = await api.getLogs(200);
    setLogs(data.logs.reverse());
  }, []);

  useEffect(() => {
    loadDashboard();
    loadActiveResume();
    loadKeywords();
    loadRuns();
    const interval = setInterval(() => {
      loadDashboard();
      loadRuns();
    }, 30000);
    return () => clearInterval(interval);
  }, [loadDashboard, loadActiveResume, loadKeywords, loadRuns]);

  useEffect(() => {
    loadAuthStatus();
    const interval = setInterval(loadAuthStatus, 5000);
    return () => clearInterval(interval);
  }, [loadAuthStatus]);

  useEffect(() => {
    const syncActiveCrawl = async () => {
      try {
        const { runs } = await api.getPendingCrawls();
        const active =
          runs.find((r) => r.status === "running") ||
          runs.find((r) => r.status === "queued");
        if (active) {
          setActiveRunId(active._id);
          if (active.live) setLiveCrawl(true);
          const progress = await api.getCrawlProgress(active._id);
          setCrawlProgress(progress);
        } else {
          setActiveRunId(null);
          setLiveCrawl(false);
          setCrawlProgress(null);
        }
      } catch {
        /* ignore poll errors */
      }
    };
    syncActiveCrawl();
    const interval = setInterval(syncActiveCrawl, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (tab === "browser" || liveCrawl) {
      loadAuthStatus();
      const interval = setInterval(loadAuthStatus, 3000);
      return () => clearInterval(interval);
    }
  }, [tab, liveCrawl, loadAuthStatus]);

  useEffect(() => {
    if (tab === "dashboard" || tab === "logs" || tab === "browser") return;
    loadJobs();
  }, [tab, loadJobs]);

  useEffect(() => {
    if (tab !== "logs") return;
    loadLogs();
    const es = api.streamLogs((log) => {
      setLogs((prev) => [...prev.slice(-199), log]);
    });
    return () => es.close();
  }, [tab, loadLogs]);

  async function handleStopCrawl() {
    setStopping(true);
    try {
      await api.stopCrawl(activeRunId || undefined);
      setAuthMessage("Search cancelled.");
      setLiveCrawl(false);
      setActiveRunId(null);
      setCrawlProgress(null);
      loadDashboard();
    } catch (err) {
      alert(err.message);
    } finally {
      setStopping(false);
    }
  }

  async function handleCrawl(crawlSource, { live = true, background = false } = {}) {
    if (!activeResume?.active) {
      alert("Upload a resume in Search Settings before crawling.");
      setTab("dashboard");
      return;
    }
    const naukriQueries = selectedQueriesForPlatform("naukri");
    const linkedinQueries = selectedQueriesForPlatform("linkedin");
    if (
      (keywordMode === "selected_only" || keywordMode === "selected_plus_ai") &&
      naukriQueries.length === 0 &&
      linkedinQueries.length === 0
    ) {
      alert("Select at least one keyword, or switch crawl mode to AI auto.");
      setTab("dashboard");
      return;
    }
    setCrawling(true);
    try {
      const result = await api.triggerCrawl({
        source: crawlSource,
        live: background ? false : live,
        freshPerKeyword,
        targetFreshJobs,
        keywordMode,
        naukriQueries,
        linkedinQueries,
      });
      if (result.live) {
        setLiveCrawl(true);
        setActiveRunId(result.run_id);
        setCrawlProgress(null);
        setTab("browser");
        setAuthMessage(result.message);
      } else {
        setActiveRunId(result.run_id);
        setCrawlProgress({
          status: "queued",
          target_fresh_jobs: result.target_fresh_jobs,
          run_id: result.run_id,
        });
        alert("Background crawl queued. You can cancel it from Search Settings.");
        setTab("dashboard");
      }
      loadRuns();
      loadKeywords();
    } catch (err) {
      alert(err.message);
    } finally {
      setCrawling(false);
    }
  }

  const isCrawlActive =
    liveCrawl ||
    authStatus?.crawl_running ||
    (activeRunId &&
      (!crawlProgress || ["running", "queued"].includes(crawlProgress.status)));

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>Job Portal</h1>
          <p className="subtitle">Naukri + LinkedIn job scraper (filter fresh jobs after crawl)</p>
        </div>
        <div className="header-actions">
          <button
            disabled={crawling || isCrawlActive}
            onClick={() => handleCrawl("all", { live: true })}
          >
            {crawling ? "Starting…" : "Run Live Crawl"}
          </button>
          {isCrawlActive && (
            <button
              type="button"
              className="btn-stop"
              disabled={stopping}
              onClick={handleStopCrawl}
            >
              {stopping ? "Cancelling…" : "Cancel Search"}
            </button>
          )}
          <button
            className="secondary"
            disabled={crawling || isCrawlActive}
            onClick={() => handleCrawl("all", { background: true })}
          >
            Background Crawl
          </button>
          <button className="secondary" onClick={() => api.exportExcel(exportParams())}>
            Export Excel
          </button>
        </div>
      </header>

      <nav className="tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="main">
        {tab === "dashboard" && stats && (
          <section>
            <SearchSettingsPanel
              activeResume={activeResume}
              onResumeChange={loadActiveResume}
              targetFreshJobs={targetFreshJobs}
              setTargetFreshJobs={setTargetFreshJobs}
              freshPerKeyword={freshPerKeyword}
              setFreshPerKeyword={setFreshPerKeyword}
              keywordMode={keywordMode}
              setKeywordMode={setKeywordMode}
              keywords={keywords}
              selectedIds={selectedKeywordIds}
              setSelectedIds={setSelectedKeywordIds}
              onReloadKeywords={loadKeywords}
              busy={settingsBusy}
              setBusy={setSettingsBusy}
              message={settingsMessage}
              setMessage={setSettingsMessage}
              crawlActive={isCrawlActive}
              crawlProgress={crawlProgress}
              onCancelSearch={handleStopCrawl}
              stopping={stopping}
            />

            {isCrawlActive && crawlProgress && (
              <LiveCrawlStats progress={crawlProgress} />
            )}

            <div className="stats-grid">
              <StatCard label="Total Jobs" value={stats.totalJobs} accent="accent-blue" />
              <StatCard label="Naukri" value={stats.naukriJobs} accent="accent-green" />
              <StatCard label="LinkedIn" value={stats.linkedinJobs} accent="accent-purple" />
              <StatCard label="Valid Open" value={stats.validOpen} accent="accent-teal" />
              <StatCard label="Applied" value={stats.applied} accent="accent-orange" />
            </div>

            <h2>Recent Crawl Runs</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Session ID</th>
                    <th>Source</th>
                    <th>Mode</th>
                    <th>Status</th>
                    <th>Discovered</th>
                    <th>Valid Open</th>
                    <th>Started</th>
                  </tr>
                </thead>
                <tbody>
                  {(stats.recentRuns || []).map((run) => (
                    <tr key={run._id}>
                      <td>
                        <button
                          type="button"
                          className="linkish"
                          title={run._id}
                          onClick={() => {
                            setFilter((f) => ({ ...f, crawl_run_id: run._id }));
                            setTab(run.source === "linkedin" ? "linkedin" : "naukri");
                          }}
                        >
                          …{String(run._id).slice(-8)}
                        </button>
                      </td>
                      <td>{run.source}</td>
                      <td>{run.keyword_mode || "ai_auto"}</td>
                      <td>{run.status}</td>
                      <td>{run.discovered}</td>
                      <td>{run.valid_open}</td>
                      <td>{new Date(run.started_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === "browser" && (
          <BrowserLoginPanel
            authStatus={authStatus}
            onRefresh={loadAuthStatus}
            busy={authBusy}
            setBusy={setAuthBusy}
            message={authMessage}
            setMessage={setAuthMessage}
            crawlRunning={isCrawlActive}
            crawlProgress={crawlProgress || authStatus?.progress}
            onStopCrawl={handleStopCrawl}
            stopping={stopping}
          />
        )}

        {(tab === "naukri" || tab === "linkedin") && (
          <section>
            <div className="filters">
              <input
                placeholder="Search title, company…"
                value={filter.q}
                onChange={(e) => setFilter({ ...filter, q: e.target.value })}
              />
              <select
                value={filter.crawl_run_id}
                onChange={(e) => setFilter({ ...filter, crawl_run_id: e.target.value })}
              >
                <option value="">All sessions</option>
                {runs.map((run) => (
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
                onChange={(e) => setFilter({ ...filter, freshness: e.target.value })}
              >
                <option value="">All freshness</option>
                <option value="fresh">Fresh</option>
                <option value="stale">Stale</option>
                <option value="unknown">Unknown</option>
              </select>
              <select
                value={filter.tier}
                onChange={(e) => setFilter({ ...filter, tier: e.target.value })}
              >
                <option value="">All tiers</option>
                <option value="1">Tier 1</option>
                <option value="2">Tier 2</option>
              </select>
              <button onClick={loadJobs}>Refresh</button>
              <button className="secondary" onClick={() => api.exportExcel(exportParams())}>
                Export filtered
              </button>
              {isCrawlActive && (
                <button type="button" className="btn-stop" disabled={stopping} onClick={handleStopCrawl}>
                  {stopping ? "Cancelling…" : "Cancel Search"}
                </button>
              )}
              <button disabled={isCrawlActive || crawling} onClick={() => handleCrawl(source, { live: true })}>
                Live Crawl {source}
              </button>
              <button
                className="secondary"
                disabled={isCrawlActive || crawling}
                onClick={() => handleCrawl(source, { background: true })}
              >
                Background
              </button>
            </div>
            {loading ? <p className="empty">Loading…</p> : <JobsTable jobs={jobs} />}
          </section>
        )}

        {tab === "logs" && (
          <section className="logs-panel">
            <h2>Live Crawl Logs</h2>
            <div className="log-stream">
              {logs.map((log) => (
                <div key={log._id || `${log.created_at}-${log.message}`} className={`log-line log-${log.level}`}>
                  <span className="log-time">
                    {new Date(log.created_at).toLocaleTimeString()}
                  </span>
                  <span className="log-source">[{log.source || "worker"}]</span>
                  <span>{log.message}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
