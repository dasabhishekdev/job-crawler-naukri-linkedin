import { useCallback, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { usePoll } from "../hooks";
import { Alert, Button, Empty, timeAgo } from "../components/ui";

const HELP_REASONS = {
  captcha: "CAPTCHA",
  otp: "OTP / verify mobile",
  checkpoint: "Security checkpoint",
  timeout: "Timed out",
  portal_disconnected: "Portal not connected",
  not_easy_apply: "Not Easy Apply",
  external_apply: "Left the portal",
  complex_form: "Form needs answers we cannot fill",
  unmapped_field: "Required field we cannot fill",
  skipped_by_user: "Skipped",
};

const PORTAL_LABELS = {
  naukri_easy: "Naukri",
  linkedin_easy: "LinkedIn",
};

function reasonLabel(app) {
  return HELP_REASONS[app.help_reason] || app.help_reason || app.last_error || "Needs a look";
}

export function NeedsHelpPage() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState("");

  const load = useCallback(async () => {
    try {
      const data = await api.listApplications({ status: "needs_help" });
      setRows(data.applications);
      setError("");
    } catch (err) {
      setError(err.message);
    }
  }, []);

  usePoll(load, 15000);

  async function act(id, label, fn, okText) {
    setBusy(`${label}-${id}`);
    setError("");
    setMessage("");
    try {
      await fn();
      await load();
      if (okText) setMessage(okText);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Needs help</h1>
          <p className="muted small">Jobs auto-apply could not finish. Retry, skip, or mark them applied yourself.</p>
        </div>
      </header>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{message}</Alert>

      {rows === null ? (
        <p className="muted">Loading…</p>
      ) : rows.length ? (
        <ul className="list card">
          {rows.map((app) => (
            <li key={app.id} className="list-row wrap">
              <div className="grow min0">
                <p className="strong">
                  {app.job?.title || "Job"} {app.job?.company ? <span className="muted">· {app.job.company}</span> : null}
                </p>
                <p className="muted small truncate">
                  {PORTAL_LABELS[app.portal_kind] || app.portal_kind} · {reasonLabel(app)}
                  {app.attempts ? ` · ${app.attempts} attempt${app.attempts === 1 ? "" : "s"}` : ""}
                  {app.updated_at ? ` · ${timeAgo(app.updated_at)}` : ""}
                </p>
                {app.last_error && app.last_error !== app.help_reason ? <p className="muted small truncate">{app.last_error}</p> : null}
              </div>
              <div className="row gap wrap">
                {app.job?.job_url ? (
                  <a className="btn btn-ghost btn-sm" href={app.job.job_url} target="_blank" rel="noreferrer noopener">
                    Open
                  </a>
                ) : null}
                <Button
                  variant="secondary"
                  className="btn-sm"
                  busy={busy === `retry-${app.id}`}
                  onClick={() => act(app.id, "retry", () => api.retryApplication(app.id), "Queued to retry.")}
                >
                  Retry
                </Button>
                <Button
                  variant="ghost"
                  className="btn-sm"
                  busy={busy === `skip-${app.id}`}
                  onClick={() => act(app.id, "skip", () => api.skipApplication(app.id), "Skipped.")}
                >
                  Skip
                </Button>
                <Button
                  variant="ghost"
                  className="btn-sm"
                  busy={busy === `mark-${app.id}`}
                  onClick={() => act(app.id, "mark", () => api.markApplicationApplied(app.id), "Marked applied.")}
                >
                  Mark applied
                </Button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty title="Nothing needs help">
          When auto-apply hits a CAPTCHA, OTP, or a field it cannot fill, the job shows up here. Turn it on in{" "}
          <Link to="/settings">Settings</Link>.
        </Empty>
      )}
    </div>
  );
}
