import { useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { Alert, Button, Field } from "../components/ui";

export function ForcePasswordChange() {
  const { setSession, logout } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      setSession(await api.changePassword({ new_password: password }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <form className="auth-card stack" onSubmit={submit}>
        <h1>Choose a new password</h1>
        <p className="muted">Your password was reset by an administrator. Set your own password to continue.</p>
        <Field label="New password" hint="At least 8 characters.">
          {(id) => <input id={id} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />}
        </Field>
        <Alert tone="error">{error}</Alert>
        <Button type="submit" busy={busy} className="btn-block">
          Save password
        </Button>
        <button type="button" className="link-btn center" onClick={logout}>
          Sign out
        </button>
      </form>
    </div>
  );
}
