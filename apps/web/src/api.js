import { getApiBaseUrl } from "./urls";

const API_URL = getApiBaseUrl();

async function request(path, options = {}) {
  const res = await fetch(`${API_URL}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || res.statusText);
  }
  return res.json();
}

export const api = {
  getDashboard: () => request("/api/stats/dashboard"),
  getJobs: (params) => {
    const qs = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        qs.set(key, value);
      }
    });
    return request(`/api/jobs?${qs.toString()}`);
  },
  getRuns: (limit = 50) => request(`/api/runs?limit=${limit}`),
  getLogs: (limit = 100) => request(`/api/logs?limit=${limit}`),
  triggerCrawl: ({
    source = "all",
    live = true,
    freshPerKeyword = 8,
    targetFreshJobs = 20,
    keywordMode = "ai_auto",
    naukriQueries = [],
    linkedinQueries = [],
  } = {}) =>
    request("/api/crawl/trigger", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source,
        live,
        fresh_per_keyword_threshold: freshPerKeyword,
        target_fresh_jobs: targetFreshJobs,
        keyword_mode: keywordMode,
        naukri_queries: naukriQueries,
        linkedin_queries: linkedinQueries,
      }),
    }),
  getLiveCrawlStatus: () => request("/api/crawl/live-status"),
  getCrawlProgress: (runId) => request(`/api/crawl/progress/${runId}`),
  getPendingCrawls: () => request("/api/crawl/pending"),
  stopCrawl: (runId) =>
    request("/api/crawl/stop", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runId ? { run_id: runId } : {}),
    }),
  uploadResume: async (file) => {
    const form = new FormData();
    form.append("resume", file);
    const res = await fetch(`${API_URL}/api/resume/upload`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || res.statusText);
    }
    return res.json();
  },
  getActiveResume: () => request("/api/resume/active"),
  listKeywords: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/keywords${qs ? `?${qs}` : ""}`);
  },
  addKeyword: (text, platform = "naukri") =>
    request("/api/keywords", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, platform }),
    }),
  generateKeywords: (targetFreshJobs = 20, freshPerKeyword = 8, platform) =>
    request("/api/keywords/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_fresh_jobs: targetFreshJobs,
        fresh_per_keyword_threshold: freshPerKeyword,
        ...(platform ? { platform } : {}),
      }),
    }),
  previewKeywords: (targetFreshJobs = 20, freshPerKeyword = 8, save = false, platform) =>
    request("/api/keywords/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        target_fresh_jobs: targetFreshJobs,
        fresh_per_keyword_threshold: freshPerKeyword,
        save,
        ...(platform ? { platform } : {}),
      }),
    }),
  deleteKeyword: (id, hard = false) =>
    request(`/api/keywords/${id}${hard ? "?hard=true" : ""}`, { method: "DELETE" }),
  exportExcel: (params = {}) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        qs.set(key, value);
      }
    });
    const query = qs.toString();
    window.open(`${API_URL}/api/export/excel${query ? `?${query}` : ""}`, "_blank");
  },
  streamLogs: (onLog) => {
    const es = new EventSource(`${API_URL}/api/logs/stream`);
    es.addEventListener("log", (e) => onLog(JSON.parse(e.data)));
    es.addEventListener("error", () => es.close());
    return es;
  },
  getAuthStatus: () => request("/api/auth/status"),
  openAuthLogin: (platform) =>
    request(`/api/auth/open/${platform}`, { method: "POST" }),
  saveAuthSession: (platform) =>
    request(`/api/auth/save/${platform}`, { method: "POST" }),
  listCandidates: () => request("/api/candidates"),
  activateCandidate: (id) =>
    request(`/api/candidates/${id}/activate`, { method: "POST" }),
  getAgentStatus: () => request("/api/agent/status"),
  runAgent: ({ live = true, source = "naukri" } = {}) =>
    request("/api/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ live, source }),
    }),
  streamAgentEvents: (onEvent) => {
    const es = new EventSource(`${API_URL}/api/agent/events/stream`);
    es.addEventListener("event", (e) => onEvent(JSON.parse(e.data)));
    es.addEventListener("error", () => es.close());
    return es;
  },
  getOpenAiSettings: () => request("/api/settings/openai"),
  checkOpenAiKey: (payload = {}) =>
    request("/api/settings/openai/check", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  saveOpenAiSettings: (payload) =>
    request("/api/settings/openai", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    }),
  getMultiStatus: () => request("/api/multi/status"),
  saveMultiSettings: (patch) =>
    request("/api/multi/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  runMulti: () => request("/api/multi/run", { method: "POST" }),
  stopMulti: () => request("/api/multi/stop", { method: "POST" }),
  saveCareerPages: (pages) =>
    request("/api/multi/career-pages", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pages }),
    }),
  getMultiJobs: (params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "")
    ).toString();
    return request(`/api/multi/jobs${qs ? `?${qs}` : ""}`);
  },
  tailorJob: (id) => request(`/api/multi/jobs/${id}/tailor`, { method: "POST" }),
  getGoogleStatus: () => request("/api/google/status"),
  getGoogleAuthUrl: () => request("/api/google/auth-url"),
  disconnectGoogle: () => request("/api/google/disconnect", { method: "POST" }),
  syncGoogleSheet: () => request("/api/google/sync", { method: "POST" }),
};
