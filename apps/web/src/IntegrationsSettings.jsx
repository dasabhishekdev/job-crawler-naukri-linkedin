import { useEffect, useState } from "react";
import { api } from "./api";

const THRESHOLDS = [
  { key: "min_fit_to_sync", label: "Min match % to add to the sheet" },
  { key: "tailor_min_fit", label: "Tailor resume when match % is at least" },
  { key: "tailor_max_ats", label: "…and ATS % is below" },
  { key: "max_tailor_per_run", label: "Max tailored resumes per run" },
  { key: "max_agent_batches", label: "Web agent searches per run (3 roles each)" },
  { key: "jobs_per_batch", label: "Jobs requested per search" },
  { key: "max_job_age_days", label: "Skip postings older than (days)" },
];

export function IntegrationsSettings() {
  const [google, setGoogle] = useState(null);
  const [crawler, setCrawler] = useState(null);
  const [engines, setEngines] = useState({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function load() {
    try {
      const status = await api.getMultiStatus();
      setGoogle(status.google);
      setCrawler(status.settings);
      setEngines(status.engines || {});
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    const params = new URLSearchParams(window.location.search);
    if (params.get("google") === "connected") setMessage(`Google Drive connected${params.get("email") ? ` as ${params.get("email")}` : ""}.`);
    if (params.get("google") === "error") setError(`Google sign-in failed: ${params.get("message") || "unknown error"}`);
    if (params.get("google")) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  async function run(fn, okText) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      if (okText) setMessage(okText);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function connectGoogle() {
    setError("");
    try {
      const { url } = await api.getGoogleAuthUrl();
      window.location.href = url;
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <section className="settings-page">
      <header className="settings-page-hero">
        <div>
          <p className="mission-kicker">Integrations</p>
          <h2>Google Drive and all-sources crawler</h2>
          <p className="settings-hint">
            The crawler writes a Google Sheet (newest jobs first) and uploads tailored resume PDFs to your Drive. It only
            sees files it creates.
          </p>
        </div>
        <div className={`settings-status-chip ${google?.connected ? "ok" : "warn"}`}>
          {google?.connected ? `Connected · ${google.email}` : google?.configured ? "Not connected" : "Client ID missing"}
        </div>
      </header>

      <div className="settings-form">
        <div className="settings-form-actions">
          {google?.connected ? (
            <>
              <button type="button" disabled={busy} onClick={() => run(() => api.syncGoogleSheet(), "Sheet updated.")}>
                Sync sheet now
              </button>
              <button type="button" className="secondary" disabled={busy} onClick={() => run(() => api.disconnectGoogle(), "Disconnected.")}>
                Disconnect
              </button>
            </>
          ) : (
            <button type="button" disabled={busy || !google?.configured} onClick={connectGoogle}>
              Connect Google Drive
            </button>
          )}
          <span className={`settings-status-chip ${engines.cursor ? "ok" : "warn"}`}>
            {engines.cursor ? "Cursor API key loaded" : "Set CURSOR_API_KEY in .env"}
          </span>
        </div>

        {google && !google.configured ? (
          <ol className="setup-steps">
            <li>
              Open <a href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">Google Cloud → Credentials</a>{" "}
              and create a project.
            </li>
            <li>Enable the Google Drive API and the Google Sheets API.</li>
            <li>OAuth consent screen: External, add your Gmail as a test user, then click Publish app (avoids 7-day token expiry).</li>
            <li>
              Create an OAuth client ID of type Web application with redirect URI <code>{google.redirect_uri}</code>.
            </li>
            <li>
              Put <code>GOOGLE_CLIENT_ID</code> and <code>GOOGLE_CLIENT_SECRET</code> in <code>job-crawler/.env</code>, then run{" "}
              <code>docker compose up -d</code>.
            </li>
          </ol>
        ) : null}

        {crawler ? (
          <fieldset className="model-fieldset">
            <legend>Crawler thresholds</legend>
            <label className="settings-field">
              <span>Search location</span>
              <input value={crawler.location} onChange={(e) => setCrawler({ ...crawler, location: e.target.value })} />
            </label>
            <div className="threshold-grid">
              {THRESHOLDS.map((t) => (
                <label key={t.key} className="settings-field">
                  <span>{t.label}</span>
                  <input
                    type="number"
                    value={crawler[t.key]}
                    onChange={(e) => setCrawler({ ...crawler, [t.key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <div className="settings-form-actions">
              <button type="button" disabled={busy} onClick={() => run(() => api.saveMultiSettings(crawler), "Crawler settings saved.")}>
                Save crawler settings
              </button>
            </div>
          </fieldset>
        ) : null}

        {error ? <p className="settings-error">{error}</p> : null}
        {message ? <p className="settings-ok">{message}</p> : null}
      </div>
    </section>
  );
}
