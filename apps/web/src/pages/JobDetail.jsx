import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { usePoll } from "../hooks";
import { Alert, ApplyBadge, Button, ScorePill, formatDateTime, timeAgo } from "../components/ui";

const STAGE_TEXT = {
  score: "Reading the job description…",
  write: "Writing your tailored resume…",
  pdf: "Creating the PDF…",
  upload: "Uploading to Google Drive…",
};

export function JobDetail({ jobId, onStatusChange }) {
  const [data, setData] = useState(null);
  const [runId, setRunId] = useState(null);
  const [run, setRun] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [showDescription, setShowDescription] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.getJob(jobId));
    } catch (err) {
      setError(err.message);
    }
  }, [jobId]);

  useEffect(() => {
    load();
  }, [load]);

  usePoll(
    async () => {
      const { run: latest } = await api.getRun(runId);
      setRun(latest);
      if (!["queued", "running"].includes(latest.status)) {
        setRunId(null);
        if (latest.status === "failed") setError(latest.error || "Resume generation failed.");
        await load();
      }
    },
    3000,
    Boolean(runId)
  );

  if (!data) return error ? <Alert tone="error">{error}</Alert> : <p className="muted">Loading…</p>;
  const { job, resumes } = data;
  const missing = job.match?.missing || [];
  const matched = (job.match?.keywords || []).filter((k) => !missing.includes(k));

  async function setStatus(status) {
    setBusy(status);
    try {
      const res = await api.setJobStatus(job._id, status);
      setData((d) => ({ ...d, job: { ...d.job, status: res.job.status } }));
      onStatusChange?.(res.job);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function generate() {
    setError("");
    setBusy("generate");
    try {
      const res = await api.generateResume(job._id);
      setRunId(res.run_id);
      setRun({ status: "queued" });
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const generating = Boolean(runId);

  return (
    <div className="stack job-detail">
      <div>
        <h3 className="detail-title">{job.title}</h3>
        <p className="muted">
          {job.company} · {job.location || "Location not listed"}
        </p>
        <p className="muted small">
          {job.source_site || (job.source === "career_page" ? "Career page" : "Web")} · found {timeAgo(job.first_seen_at)}
          {job.posted_text ? ` · posted ${job.posted_text}` : ""}
        </p>
      </div>
      <div className="row gap wrap">
        <ScorePill value={job.match?.score} label="Match" />
        <ScorePill value={job.match?.ats_score} label="ATS" good={75} ok={55} />
        {job.match?.relevancy ? <span className={`badge rel-${job.match.relevancy.toLowerCase()}`}>{job.match.relevancy} relevancy</span> : null}
        <ApplyBadge status={job.apply_status} />
      </div>
      {job.apply_status === "needs_help" ? (
        <p className="muted small">
          Auto-apply got stuck. Review it in <Link to="/needs-help">Needs help</Link>.
        </p>
      ) : null}
      {job.match?.summary ? <p>{job.match.summary}</p> : <p className="muted">This job has not been scored yet.</p>}

      <div className="row gap wrap">
        <a className="btn btn-primary" href={job.job_url} target="_blank" rel="noreferrer noopener">
          Apply on site
        </a>
        <Button variant={job.status === "saved" ? "secondary" : "ghost"} busy={busy === "saved"} onClick={() => setStatus(job.status === "saved" ? "new" : "saved")}>
          {job.status === "saved" ? "Saved ✓" : "Save"}
        </Button>
        <Button variant={job.status === "applied" ? "secondary" : "ghost"} busy={busy === "applied"} onClick={() => setStatus(job.status === "applied" ? "saved" : "applied")}>
          {job.status === "applied" ? "Applied ✓" : "Mark applied"}
        </Button>
        <Button variant="ghost" busy={busy === "hidden"} onClick={() => setStatus(job.status === "hidden" ? "new" : "hidden")}>
          {job.status === "hidden" ? "Unhide" : "Hide"}
        </Button>
      </div>

      {missing.length || matched.length ? (
        <div className="stack-sm">
          <h4>ATS keywords</h4>
          <div className="chips">
            {matched.map((k) => (
              <span key={k} className="chip chip-good">{k}</span>
            ))}
            {missing.map((k) => (
              <span key={k} className="chip chip-missing" title="Not found in your resume">{k}</span>
            ))}
          </div>
          {missing.length ? <p className="muted small">Grey keywords are missing from your resume.</p> : null}
        </div>
      ) : null}

      <div className="card card-flat stack-sm">
        <h4>Tailored resume</h4>
        <p className="muted small">
          AI rewrites your resume for this job using its keywords. It keeps your real employers, titles, dates and numbers.
        </p>
        {generating ? (
          <div className="progress-note">
            <span className="spinner" aria-hidden="true" />
            {STAGE_TEXT[run?.stage] || (run?.status === "queued" ? "Waiting to start…" : "Working…")}
          </div>
        ) : (
          <Button busy={busy === "generate"} onClick={generate}>
            {resumes.length ? "Generate a new version" : "Generate resume"}
          </Button>
        )}
        {resumes.map((r) => (
          <div key={r.id} className="file-row">
            <div className="grow">
              <p className="strong small">{formatDateTime(r.created_at)}</p>
              {r.status === "done" ? (
                <p className="muted small">
                  ATS {r.ats_before ?? "?"}% → <strong>{r.ats_after ?? "?"}%</strong>
                </p>
              ) : (
                <p className="field-error small">{r.error || r.status}</p>
              )}
            </div>
            {r.status === "done" ? (
              <div className="row gap">
                <a className="btn btn-secondary btn-sm" href={api.generatedPdfUrl(r.id)}>
                  PDF
                </a>
                {r.drive_url ? (
                  <a className="btn btn-ghost btn-sm" href={r.drive_url} target="_blank" rel="noreferrer">
                    Drive
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <Alert tone="error">{error}</Alert>

      {job.description ? (
        <div className="stack-sm">
          <button type="button" className="link-btn" onClick={() => setShowDescription((v) => !v)} aria-expanded={showDescription}>
            {showDescription ? "Hide job description" : "Show job description"}
          </button>
          {showDescription ? <p className="description">{job.description}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
