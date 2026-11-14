import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { usePoll } from "../hooks";
import { Alert, Button, Toggle } from "../components/ui";
import { ResumeUploader } from "../settings/ResumeUploader";
import { AiSettings } from "../settings/AiSettings";
import { ProfileForm } from "../settings/ProfileForm";

const STEPS = ["Resume", "AI provider", "Profile", "Start"];

function firstIncomplete(onboarding) {
  if (!onboarding?.resume) return 0;
  if (!onboarding?.ai) return 1;
  if (!onboarding?.profile) return 2;
  return 3;
}

export function Onboarding() {
  const { onboarding, refresh, logout, user } = useAuth();
  const navigate = useNavigate();
  const [step, setStep] = useState(() => firstIncomplete(onboarding));
  const [resume, setResume] = useState(null);
  const [settings, setSettings] = useState(null);
  const [profile, setProfile] = useState(null);
  const [hourly, setHourly] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const loadResume = useCallback(async () => setResume((await api.getResume()).resume), []);
  const loadProfile = useCallback(async () => setProfile((await api.getProfile()).profile), []);

  useEffect(() => {
    loadResume().catch(() => {});
    api.getSettings().then(setSettings).catch(() => {});
    loadProfile().catch(() => {});
  }, [loadResume, loadProfile]);

  const parsing = resume && ["pending", "parsing"].includes(resume.parse_status) && settings?.ai?.ready;
  usePoll(
    async () => {
      const latest = (await api.getResume()).resume;
      setResume(latest);
      if (latest?.parse_status === "done" || latest?.parse_status === "failed") await loadProfile();
    },
    3000,
    step === 2 && Boolean(parsing)
  );

  async function advance() {
    const data = await refresh();
    setStep(Math.max(step + 1, firstIncomplete(data?.onboarding)));
  }

  async function finish() {
    setBusy(true);
    setError("");
    try {
      await api.saveCrawler({ hourly_enabled: hourly });
      await api.startCrawl();
      await refresh();
      navigate("/jobs", { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="onboarding">
      <header className="onboarding-head">
        <div className="brand">
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <span>Job Crawler</span>
        </div>
        <button type="button" className="link-btn" onClick={logout}>
          Sign out
        </button>
      </header>
      <ol className="stepper" aria-label="Setup steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? "is-current" : i < step ? "is-done" : ""}>
            <button type="button" disabled={i > firstIncomplete(onboarding)} onClick={() => setStep(i)}>
              <span className="step-num">{i < step ? "✓" : i + 1}</span>
              <span className="step-label">{label}</span>
            </button>
          </li>
        ))}
      </ol>

      <section className="card onboarding-card">
        {step === 0 ? (
          <>
            <h1>Hi {user?.name?.split(" ")[0] || "there"}, start with your resume</h1>
            <p className="muted">We read it to understand your experience, then search for jobs that fit.</p>
            <ResumeUploader
              resume={resume}
              onUploaded={async (data) => {
                setResume(data.resume);
                await advance();
              }}
            />
            {resume ? <Button variant="secondary" onClick={advance}>Continue</Button> : null}
          </>
        ) : null}

        {step === 1 ? (
          <>
            <h1>Connect an AI provider</h1>
            <AiSettings
              settings={settings}
              onChange={async (data) => {
                setSettings((prev) => ({ ...prev, ...data }));
                if (data.ai?.ready) {
                  await loadResume();
                  await advance();
                }
              }}
            />
          </>
        ) : null}

        {step === 2 ? (
          <>
            <h1>Check your job search profile</h1>
            {parsing ? (
              <div className="progress-note">
                <span className="spinner" aria-hidden="true" /> AI is reading your resume. This usually takes under a minute…
              </div>
            ) : resume?.parse_status === "failed" ? (
              <Alert tone="error">
                We could not analyse your resume automatically ({resume.parse_error}). Fill in your target roles below, or{" "}
                <button type="button" className="link-btn" onClick={() => api.reparseResume().then(loadResume)}>
                  try again
                </button>
                .
              </Alert>
            ) : (
              <p className="muted">These come from your resume. Edit anything, then save.</p>
            )}
            <ProfileForm profile={profile} compact submitLabel="Save and continue" onSaved={async (p) => { setProfile(p); await advance(); }} />
          </>
        ) : null}

        {step === 3 ? (
          <>
            <h1>You are all set</h1>
            <p className="muted">
              We will search for {profile?.target_roles?.slice(0, 3).join(", ")}
              {profile?.target_roles?.length > 3 ? " and more" : ""} in {profile?.target_locations?.join(", ") || "your city"}.
              New matches appear newest first on your Jobs page.
            </p>
            <Toggle checked={hourly} onChange={setHourly} label="Keep searching every hour" description="You can change this any time in Settings." />
            <Alert tone="error">{error}</Alert>
            <Button busy={busy} onClick={finish} className="btn-block">
              Find jobs now
            </Button>
          </>
        ) : null}
      </section>
    </div>
  );
}
