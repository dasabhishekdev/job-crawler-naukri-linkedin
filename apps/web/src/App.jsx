import { useEffect, useState, useCallback } from "react";
import { api } from "./api";
import { CandidateSwitcher, AgentStatusBadge } from "./MissionControl";
import { SettingsPanel } from "./Settings";
import { PlatformWorkspace } from "./PlatformWorkspace";
import { AllSources } from "./AllSources";
import { IntegrationsSettings } from "./IntegrationsSettings";

const TABS = [
  { id: "all", label: "All Sources" },
  { id: "naukri", label: "Naukri", source: "naukri" },
  { id: "linkedin", label: "LinkedIn", source: "linkedin" },
  { id: "settings", label: "Settings" },
];

export default function App() {
  const [tab, setTab] = useState(() =>
    new URLSearchParams(window.location.search).has("google") ? "settings" : "all"
  );
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
  const [keywordModeByPlatform, setKeywordModeByPlatform] = useState({
    naukri: "selected_plus_ai",
    linkedin: "selected_plus_ai",
  });
  const [keywords, setKeywords] = useState([]);
  const [selectedKeywordIds, setSelectedKeywordIds] = useState([]);
  const [runs, setRuns] = useState([]);
  const [candidates, setCandidates] = useState([]);
  const [agentStatus, setAgentStatus] = useState(null);
  const [agentStarting, setAgentStarting] = useState(false);

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

  const loadCandidates = useCallback(async () => {
    try {
      const data = await api.listCandidates();
      setCandidates(data.candidates || []);
    } catch {
      setCandidates([]);
    }
  }, []);

  const loadAgentStatus = useCallback(async () => {
    try {
      const data = await api.getAgentStatus();
      setAgentStatus(data);
    } catch {
      setAgentStatus(null);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    if (!source) return;
    setLoading(true);
    try {
      const params = { limit: 200, sort: "-scraped_at", source };
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
    loadCandidates();
    loadAgentStatus();
    const interval = setInterval(() => {
      loadDashboard();
      loadRuns();
      loadAgentStatus();
    }, 5000);
    return () => clearInterval(interval);
  }, [loadDashboard, loadActiveResume, loadKeywords, loadRuns, loadCandidates, loadAgentStatus]);

  useEffect(() => {
    loadAuthStatus();
    const interval = setInterval(loadAuthStatus, 5000);
    return () => clearInterval(interval);
  }, [loadAuthStatus]);

  useEffect(() => {
    const syncActiveCrawl = async () => {
      try {
        const { runs: pending } = await api.getPendingCrawls();
        const active =
          pending.find((r) => r.status === "running") ||
          pending.find((r) => r.status === "queued");
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
    if (tab === "naukri" || tab === "linkedin" || liveCrawl) {
      loadAuthStatus();
      const interval = setInterval(loadAuthStatus, 3000);
      return () => clearInterval(interval);
    }
  }, [tab, liveCrawl, loadAuthStatus]);

  useEffect(() => {
    if (tab === "settings") return;
    loadJobs();
  }, [tab, loadJobs]);

  useEffect(() => {
    const es = api.streamAgentEvents((ev) => {
      setAgentStatus((prev) => {
        const events = [...(prev?.events || []), ev].slice(-80);
        return { ...(prev || {}), events };
      });
    });
    return () => es.close();
  }, []);

  useEffect(() => {
    if (tab === "settings") return;
    loadLogs();
    const es = api.streamLogs((log) => {
      setLogs((prev) => [...prev.slice(-199), log]);
    });
    return () => es.close();
  }, [tab, loadLogs]);

  async function handleActivateCandidate(id) {
    try {
      await api.activateCandidate(id);
      await Promise.all([loadCandidates(), loadAgentStatus(), loadActiveResume(), loadDashboard()]);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleRunAgent({ live = true } = {}) {
    if (!activeResume?.active) {
      alert("Upload a resume for the active candidate first.");
      return;
    }
    setAgentStarting(true);
    try {
      const result = await api.runAgent({ live, source: "naukri" });
      setActiveRunId(result.run_id);
      if (result.live) {
        setLiveCrawl(true);
        setTab("naukri");
        setAuthMessage(result.message);
      }
      loadAgentStatus();
      loadRuns();
    } catch (err) {
      alert(err.message);
    } finally {
      setAgentStarting(false);
    }
  }

  async function handleStopCrawl() {
    setStopping(true);
    try {
      await api.stopCrawl(activeRunId || undefined);
      setAuthMessage("Search cancelled.");
      setLiveCrawl(false);
      setActiveRunId(null);
      setCrawlProgress(null);
      loadDashboard();
      loadAgentStatus();
    } catch (err) {
      alert(err.message);
    } finally {
      setStopping(false);
    }
  }

  async function handleCrawl(crawlSource, { live = true, background = false } = {}) {
    if (!activeResume?.active) {
      alert("Upload a resume in this platform’s keyword section before crawling.");
      return;
    }
    const keywordMode = keywordModeByPlatform[crawlSource] || "selected_plus_ai";
    const naukriQueries = crawlSource === "naukri" ? selectedQueriesForPlatform("naukri") : [];
    const linkedinQueries = crawlSource === "linkedin" ? selectedQueriesForPlatform("linkedin") : [];
    if (
      (keywordMode === "selected_only" || keywordMode === "selected_plus_ai") &&
      ((crawlSource === "naukri" && naukriQueries.length === 0) ||
        (crawlSource === "linkedin" && linkedinQueries.length === 0))
    ) {
      alert(`Select at least one ${crawlSource === "naukri" ? "Naukri" : "LinkedIn"} keyword, or switch crawl mode to AI auto.`);
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
      setActiveRunId(result.run_id);
      if (result.live) {
        setLiveCrawl(true);
        setCrawlProgress(null);
        setTab(crawlSource);
        setAuthMessage(result.message);
      } else {
        setCrawlProgress({
          status: "queued",
          target_fresh_jobs: result.target_fresh_jobs,
          run_id: result.run_id,
          source: crawlSource,
        });
        setAuthMessage("Background crawl queued. You can cancel it from this platform page.");
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

  const crawlSource =
    crawlProgress?.source ||
    authStatus?.progress?.source ||
    authStatus?.crawl_source ||
    null;

  const workspaceProps = source
    ? {
        platform: source,
        stats,
        jobs,
        loading,
        runs,
        filter,
        setFilter,
        onRefreshJobs: loadJobs,
        onExport: () => api.exportExcel(exportParams()),
        logs,
        authStatus,
        onRefreshAuth: loadAuthStatus,
        authBusy,
        setAuthBusy,
        authMessage,
        setAuthMessage,
        crawlActive: isCrawlActive,
        crawlProgress: crawlProgress || authStatus?.progress,
        crawlSource,
        crawling: crawling || agentStarting,
        stopping,
        onStopCrawl: handleStopCrawl,
        onLiveCrawl: () => handleCrawl(source, { live: true }),
        onBackgroundCrawl: () => handleCrawl(source, { background: true }),
        activeResume,
        onResumeChange: loadActiveResume,
        targetFreshJobs,
        setTargetFreshJobs,
        freshPerKeyword,
        setFreshPerKeyword,
        keywordMode: keywordModeByPlatform[source],
        setKeywordMode: (mode) =>
          setKeywordModeByPlatform((prev) => ({ ...prev, [source]: mode })),
        keywords,
        selectedIds: selectedKeywordIds,
        setSelectedIds: setSelectedKeywordIds,
        onReloadKeywords: loadKeywords,
        settingsBusy,
        setSettingsBusy,
        settingsMessage,
        setSettingsMessage,
        agentStatus,
        agentStarting,
        onRunAgent: handleRunAgent,
        onOpenSettings: () => setTab("settings"),
      }
    : null;

  return (
    <div className="app">
      <header className="header">
        <div className="header-brand">
          <h1>Job Crawler</h1>
          <p className="subtitle">Any-site hourly crawl plus Naukri and LinkedIn, synced to Google Drive</p>
        </div>
        <div className="header-actions">
          <CandidateSwitcher
            candidates={candidates}
            activeId={candidates.find((c) => c.is_active)?._id}
            onChange={handleActivateCandidate}
            disabled={isCrawlActive}
          />
          <AgentStatusBadge status={agentStatus?.agent_status} />
          {isCrawlActive && (
            <button
              type="button"
              className="btn-stop"
              disabled={stopping}
              onClick={handleStopCrawl}
            >
              {stopping ? "Cancelling…" : "Cancel"}
            </button>
          )}
          <button type="button" className="secondary" onClick={() => setTab("settings")}>
            Settings
          </button>
          <button type="button" className="secondary" onClick={() => api.exportExcel(exportParams())}>
            Export Excel
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="Platforms">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            className={tab === t.id ? "active" : ""}
            onClick={() => {
              setFilter((prev) => ({ ...prev, crawl_run_id: "" }));
              setTab(t.id);
            }}
            aria-current={tab === t.id ? "page" : undefined}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="main">
        {(tab === "naukri" || tab === "linkedin") && workspaceProps && (
          <PlatformWorkspace {...workspaceProps} />
        )}
        {tab === "all" && <AllSources candidateName={candidates.find((c) => c.is_active)?.name} />}
        {tab === "settings" && (
          <div className="settings-stack">
            <IntegrationsSettings />
            <SettingsPanel />
          </div>
        )}
      </main>
    </div>
  );
}
