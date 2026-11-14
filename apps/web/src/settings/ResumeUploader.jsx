import { useRef, useState } from "react";
import { api } from "../api";
import { Alert, Button, formatDateTime } from "../components/ui";

const PARSE_LABELS = {
  pending: "Waiting for an AI key to analyse it",
  parsing: "AI is reading your resume…",
  done: "Analysed",
  failed: "Analysis failed",
};

export function ResumeUploader({ resume, onUploaded }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      onUploaded(await api.uploadResume(file));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  return (
    <div className="stack">
      {resume ? (
        <div className="file-row">
          <div className="file-icon" aria-hidden="true">PDF</div>
          <div className="grow">
            <p className="strong">{resume.filename}</p>
            <p className="muted small">
              Uploaded {formatDateTime(resume.uploaded_at)} · {PARSE_LABELS[resume.parse_status] || resume.parse_status}
            </p>
            {resume.parse_error ? <p className="field-error">{resume.parse_error}</p> : null}
          </div>
          <a className="btn btn-ghost" href="/api/resume/file">
            Download
          </a>
        </div>
      ) : null}

      <div
        className={`dropzone ${dragging ? "is-dragging" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          upload(e.dataTransfer.files?.[0]);
        }}
      >
        <p className="strong">{resume ? "Replace your resume" : "Upload your resume"}</p>
        <p className="muted small">PDF or DOCX, up to 5 MB. Text-based files work best (not scanned images).</p>
        <input
          ref={input}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="visually-hidden"
          id="resume-file"
          onChange={(e) => upload(e.target.files?.[0])}
        />
        <Button busy={busy} onClick={() => input.current?.click()}>
          {busy ? "Uploading…" : "Choose file"}
        </Button>
      </div>
      <Alert tone="error">{error}</Alert>
    </div>
  );
}
