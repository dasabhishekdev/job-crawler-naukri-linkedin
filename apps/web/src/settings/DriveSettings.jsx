import { useState } from "react";
import { api } from "../api";
import { Alert, Button, formatDateTime } from "../components/ui";

export function DriveSettings({ settings, onChange, notice }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState(notice || "");
  const google = settings?.google;
  if (!google) return null;

  async function run(label, fn) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  if (!google.configured) {
    return <p className="muted">Google Drive sync is not enabled on this server yet.</p>;
  }

  return (
    <div className="stack">
      <p className="muted small">
        Optional. Creates a “Job Matches” Google Sheet (newest jobs first) and saves every generated resume PDF in your Drive. The
        app can only see files it creates.
      </p>
      {google.connected ? (
        <>
          <p>
            Connected as <strong>{google.email}</strong>
            {google.last_synced_at ? <span className="muted"> · sheet updated {formatDateTime(google.last_synced_at)}</span> : null}
          </p>
          {google.last_error ? <Alert tone="error">Last sync failed: {google.last_error}</Alert> : null}
          <div className="row gap wrap">
            {google.sheet_url ? (
              <a className="btn btn-primary" href={google.sheet_url} target="_blank" rel="noreferrer">
                Open Google Sheet
              </a>
            ) : null}
            <Button
              variant="secondary"
              busy={busy === "sync"}
              onClick={() =>
                run("sync", async () => {
                  const data = await api.syncDrive();
                  setMessage(`Sheet updated with ${data.rows} jobs.`);
                  onChange({ ...settings, google: data.google });
                })
              }
            >
              Sync now
            </Button>
            <Button variant="ghost" busy={busy === "disconnect"} onClick={() => run("disconnect", async () => onChange({ ...settings, google: (await api.disconnectDrive()).google }))}>
              Disconnect
            </Button>
          </div>
        </>
      ) : (
        <a className="btn btn-primary" href="/api/google/drive/connect">
          Connect Google Drive
        </a>
      )}
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{message}</Alert>
    </div>
  );
}
