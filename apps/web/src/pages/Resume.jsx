import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { useAuth } from "../auth";
import { usePoll } from "../hooks";
import { Button, Card } from "../components/ui";
import { ResumeUploader } from "../settings/ResumeUploader";
import { ProfileForm } from "../settings/ProfileForm";

export function ResumePage() {
  const { refresh } = useAuth();
  const [resume, setResume] = useState(null);
  const [text, setText] = useState("");
  const [profile, setProfile] = useState(null);
  const [showText, setShowText] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const [r, p] = await Promise.all([api.getResume(), api.getProfile()]);
    setResume(r.resume);
    setText(r.text);
    setProfile(p.profile);
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  usePoll(
    async () => {
      const r = await api.getResume();
      setResume(r.resume);
      if (!["pending", "parsing"].includes(r.resume?.parse_status)) await load();
    },
    3000,
    resume?.parse_status === "parsing"
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
            await refresh();
          }}
        />
        {resume ? (
          <div className="row gap wrap">
            <Button
              variant="ghost"
              busy={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api.reparseResume();
                  setResume({ ...resume, parse_status: "parsing" });
                } finally {
                  setBusy(false);
                }
              }}
            >
              Re-analyse with AI
            </Button>
            <button type="button" className="link-btn" aria-expanded={showText} onClick={() => setShowText((v) => !v)}>
              {showText ? "Hide extracted text" : "Show extracted text"}
            </button>
          </div>
        ) : null}
        {showText ? <pre className="extracted">{text}</pre> : null}
      </Card>

      <Card title="Job search profile">
        <ProfileForm
          profile={profile}
          onSaved={async (p) => {
            setProfile(p);
            await refresh();
          }}
        />
      </Card>
    </div>
  );
}
