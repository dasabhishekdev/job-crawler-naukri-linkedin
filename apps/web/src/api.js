export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function request(path, { method = "GET", body, form } = {}) {
  const init = { method, credentials: "same-origin", headers: {} };
  if (form) init.body = form;
  else if (body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  let res;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new ApiError(0, "Network error. Check your connection and try again.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || res.statusText || "Request failed");
  return data;
}

function qs(params = {}) {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return entries.length ? `?${new URLSearchParams(entries)}` : "";
}

export const api = {
  authConfig: () => request("/auth/config"),
  me: () => request("/auth/me"),
  signup: (body) => request("/auth/signup", { method: "POST", body }),
  login: (body) => request("/auth/login", { method: "POST", body }),
  logout: () => request("/auth/logout", { method: "POST" }),
  logoutAll: () => request("/auth/logout-all", { method: "POST" }),
  changePassword: (body) => request("/auth/password", { method: "POST", body }),

  getProfile: () => request("/profile"),
  saveProfile: (body) => request("/profile", { method: "PUT", body }),
  applySuggestion: (fields) => request("/profile/suggestion/apply", { method: "POST", body: { fields } }),
  dismissSuggestion: () => request("/profile/suggestion", { method: "DELETE" }),
  saveCareerPages: (pages) => request("/profile/career-pages", { method: "PUT", body: { pages } }),

  getResume: () => request("/resume"),
  uploadResume: (file) => {
    const form = new FormData();
    form.append("file", file);
    return request("/resume", { method: "POST", form });
  },
  reparseResume: () => request("/resume/parse", { method: "POST" }),

  getSettings: () => request("/settings"),
  saveAiKey: (provider, apiKey) => request("/settings/ai-key", { method: "PUT", body: { provider, api_key: apiKey } }),
  deleteAiKey: (provider) => request(`/settings/ai-key/${provider}`, { method: "DELETE" }),
  listModels: (provider) => request(`/settings/ai-models/${provider}`),
  saveAi: (provider, model) => request("/settings/ai", { method: "PUT", body: { provider, model } }),
  saveCrawler: (body) => request("/settings/crawler", { method: "PUT", body }),

  listJobs: (params) => request(`/jobs${qs(params)}`),
  getJob: (id) => request(`/jobs/${id}`),
  setJobStatus: (id, status) => request(`/jobs/${id}`, { method: "PATCH", body: { status } }),
  generateResume: (id) => request(`/jobs/${id}/generate-resume`, { method: "POST" }),
  generatedPdfUrl: (id) => `/api/generated-resumes/${id}/pdf`,

  listRuns: (params) => request(`/runs${qs(params)}`),
  activeRuns: () => request("/runs/active"),
  getRun: (id) => request(`/runs/${id}`),
  startCrawl: () => request("/runs/crawl", { method: "POST" }),
  cancelRun: (id) => request(`/runs/${id}/cancel`, { method: "POST" }),

  getPortals: () => request("/portals"),
  connectPortal: (portal, viewport) => request(`/portals/${portal}/connect`, { method: "POST", body: { viewport } }),
  disconnectPortal: (portal) => request(`/portals/${portal}`, { method: "DELETE" }),
  savePortalSettings: (body) => request("/portals/settings", { method: "PUT", body }),
  portalCrawl: () => request("/portals/crawl", { method: "POST" }),
  naukriRefresh: () => request("/portals/naukri/refresh", { method: "POST" }),

  disconnectDrive: () => request("/google/drive/disconnect", { method: "POST" }),
  syncDrive: () => request("/google/drive/sync", { method: "POST" }),

  adminStats: () => request("/admin/stats"),
  adminUsers: (q) => request(`/admin/users${qs({ q })}`),
  adminUpdateUser: (id, body) => request(`/admin/users/${id}`, { method: "PATCH", body }),
  adminResetPassword: (id) => request(`/admin/users/${id}/reset-password`, { method: "POST" }),
};
