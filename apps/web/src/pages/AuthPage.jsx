import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Alert, Button, Field } from "../components/ui";

const GOOGLE_ERRORS = {
  google_cancelled: "Google sign-in was cancelled.",
  google_expired: "Google sign-in took too long. Please try again.",
  google_failed: "Google sign-in failed. Please try again.",
  google_unverified: "Your Google email is not verified.",
  disabled: "This account is disabled. Contact the administrator.",
};

export function AuthPage({ mode }) {
  const isSignup = mode === "signup";
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { setSession } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(GOOGLE_ERRORS[params.get("error")] || "");
  const [googleEnabled, setGoogleEnabled] = useState(false);

  useEffect(() => {
    api.authConfig().then((c) => setGoogleEnabled(c.google_login)).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const data = isSignup ? await api.signup(form) : await api.login({ email: form.email, password: form.password });
      setSession(data);
      navigate(data.onboarding.complete ? "/jobs" : "/onboarding", { replace: true });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand brand-lg">
          <img src="/favicon.svg" alt="" width="40" height="40" />
          <span>Job Crawler</span>
        </div>
        <h1>{isSignup ? "Create your account" : "Welcome back"}</h1>
        <p className="muted">
          {isSignup
            ? "Upload your resume once. AI finds matching jobs on any site, every hour."
            : "Sign in to see your latest job matches."}
        </p>

        {googleEnabled ? (
          <>
            <a className="btn btn-google" href="/api/auth/google/start">
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
                <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
                <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
              </svg>
              Continue with Google
            </a>
            <div className="divider"><span>or</span></div>
          </>
        ) : null}

        <form onSubmit={submit} className="stack" noValidate>
          {isSignup ? (
            <Field label="Full name">
              {(id) => <input id={id} autoComplete="name" value={form.name} onChange={set("name")} required />}
            </Field>
          ) : null}
          <Field label="Email">
            {(id) => <input id={id} type="email" autoComplete="email" inputMode="email" value={form.email} onChange={set("email")} required />}
          </Field>
          <Field label="Password" hint={isSignup ? "At least 8 characters." : ""}>
            {(id) => (
              <input
                id={id}
                type="password"
                autoComplete={isSignup ? "new-password" : "current-password"}
                value={form.password}
                onChange={set("password")}
                required
                minLength={isSignup ? 8 : undefined}
              />
            )}
          </Field>
          <Alert tone="error">{error}</Alert>
          <Button type="submit" busy={busy} className="btn-block">
            {isSignup ? "Create account" : "Sign in"}
          </Button>
        </form>

        <p className="auth-switch">
          {isSignup ? "Already have an account? " : "New here? "}
          <Link to={isSignup ? "/login" : "/signup"}>{isSignup ? "Sign in" : "Create an account"}</Link>
        </p>
        {!isSignup ? <p className="muted small center">Forgot your password? Ask the administrator to reset it.</p> : null}
      </div>
    </div>
  );
}
