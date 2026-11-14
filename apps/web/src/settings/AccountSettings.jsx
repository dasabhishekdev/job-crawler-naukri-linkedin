import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Alert, Button, Field } from "../components/ui";

export function AccountSettings() {
  const { user, setSession, logout } = useAuth();
  const [form, setForm] = useState({ current_password: "", new_password: "" });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function changePassword(e) {
    e.preventDefault();
    setBusy("password");
    setError("");
    setMessage("");
    try {
      setSession(await api.changePassword(form));
      setForm({ current_password: "", new_password: "" });
      setMessage("Password updated. Other devices were signed out.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="stack">
      <p>
        Signed in as <strong>{user?.email}</strong>
        {user?.google_linked ? <span className="muted"> · Google linked</span> : null}
      </p>
      <form className="stack" onSubmit={changePassword}>
        <h3>{user?.has_password ? "Change password" : "Set a password"}</h3>
        {user?.has_password ? (
          <Field label="Current password">
            {(id) => <input id={id} type="password" autoComplete="current-password" value={form.current_password} onChange={(e) => setForm({ ...form, current_password: e.target.value })} />}
          </Field>
        ) : null}
        <Field label="New password" hint="At least 8 characters.">
          {(id) => <input id={id} type="password" autoComplete="new-password" minLength={8} value={form.new_password} onChange={(e) => setForm({ ...form, new_password: e.target.value })} />}
        </Field>
        <Button type="submit" variant="secondary" busy={busy === "password"} disabled={form.new_password.length < 8}>
          Save password
        </Button>
      </form>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{message}</Alert>
      <div className="row gap wrap">
        <Button variant="ghost" onClick={logout}>
          Sign out
        </Button>
        <Button
          variant="ghost"
          busy={busy === "all"}
          onClick={async () => {
            setBusy("all");
            await api.logoutAll().catch(() => {});
            await logout();
          }}
        >
          Sign out on all devices
        </Button>
      </div>
    </div>
  );
}
