import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { usePoll } from "../hooks";
import { Alert, Button, Card } from "../components/ui";
import { ResumeUploader } from "../settings/ResumeUploader";
import { ProfileForm } from "../settings/ProfileForm";
import { SuggestionReview } from "../settings/SuggestionReview";

const ANALYSING = ["pending", "parsing"];

export function ResumePage() {
  const { refresh, onboarding } = useAuth();
  const [resume, setResume] = useState(null);
  const [text, setText] = useState("");
  const [profile, setProfile] = useState(null);
  const [suggestion, setSuggestion] = useState(null);
  const [showText, setShowText] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const waiting = useRef(false);

  const applyProfilePayload = useCallback((data) => {
    setProfile(data.profile);
    setSuggestion(data.suggestion);
  }, []);

  const load = useCallback(async () => {
    const [r, p] = await Promise.all([api.getResume(), api.getProfile()]);
    setResume(r.resume);
    setText(r.text);
    applyProfilePayload(p);
    return p;
  }, [applyProfilePayload]);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const analysing = ANALYSING.includes(resume?.parse_status) && onboarding?.ai;

  usePoll(
    async () => {
      const r = await api.getResume();
      setResume(r.resume);
      if (ANALYSING.includes(r.resume?.parse_status)) return;
      const p = await load();
      if (waiting.current) {
        waiting.current = false;
        if (r.resume?.parse_status === "failed") setNotice("");
        else setNotice(p.suggestion ? "Analysis finished. Review the suggested changes below." : "Analysis finished. Your profile already matches your resume.");
      }
    },
    3000,
    Boolean(analysing)
  );

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Resume &amp; profile</h1>
          <p className="muted small">Your resume drives the search, the match scores and the tailored resumes.</p>
        </div>
      </header>

      <Card title="Resume">
        <ResumeUploader
          resume={resume}
          onUploaded={async (data) => {
            setResume(data.resume);
            setText(data.text);
            setNotice("");
            waiting.current = true;
            await refresh();
          }}
        />
        {resume ? (
          <div className="row gap wrap">
            <Button
              variant="ghost"
              busy={busy || Boolean(analysing)}
              onClick={async () => {
                setBusy(true);
                setNotice("");
                try {
                  await api.reparseResume();
                  waiting.current = true;
                  setResume({ ...resume, parse_status: "parsing" });
                } catch (err) {
                  setNotice(err.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {analysing ? "Analysing…" : "Re-analyse with AI"}
            </Button>
            <button type="button" className="link-btn" aria-expanded={showText} onClick={() => setShowText((v) => !v)}>
              {showText ? "Hide extracted text" : "Show extracted text"}
            </button>
          </div>
        ) : null}
        {analysing ? (
          <div className="progress-note">
            <span className="spinner" aria-hidden="true" /> AI is reading your resume. Suggestions appear here when it finishes.
          </div>
        ) : null}
        <Alert tone="success">{notice}</Alert>
        {showText ? <pre className="extracted">{text}</pre> : null}
      </Card>

      <SuggestionReview
        suggestion={suggestion}
        onApplied={async (data) => {
          applyProfilePayload(data);
          setNotice(data.applied?.length ? `Applied ${data.applied.length} change${data.applied.length > 1 ? "s" : ""} to your profile.` : "Suggestions dismissed.");
          await refresh();
        }}
      />

      <Card title="Job search profile">
        <ProfileForm
          profile={profile}
          onSaved={async () => {
            await load();
            await refresh();
          }}
        />
      </Card>
    </div>
  );
}
