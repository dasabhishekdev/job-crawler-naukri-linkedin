/** Resolve API/VNC URLs for localhost and LAN (same Wi‑Fi) access. */

function currentHost() {
  if (typeof window === "undefined") return "localhost";
  return window.location.hostname || "localhost";
}

function envPointsToLocalhost(url) {
  return !url || /:\/\/localhost(?::|\/|$)/i.test(url) || /:\/\/127\.0\.0\.1(?::|\/|$)/i.test(url);
}

export function getApiBaseUrl() {
  const env = import.meta.env.VITE_API_URL;
  if (env && !envPointsToLocalhost(env)) return env.replace(/\/$/, "");
  const protocol = window.location.protocol === "https:" ? "https:" : "http:";
  return `${protocol}//${currentHost()}:4000`;
}

export function getVncBaseUrl() {
  const env = import.meta.env.VITE_VNC_URL;
  if (env && !envPointsToLocalhost(env)) return env;
  return `http://${currentHost()}:6080/vnc.html?autoconnect=true&resize=scale`;
}
