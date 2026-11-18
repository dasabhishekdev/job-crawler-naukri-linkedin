import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { Alert, Button, Field, Toggle } from "../components/ui";

const EMPTY = {
  full_name: "",
  email: "",
  phone: "",
  current_location: "",
  linkedin_url: "",
  naukri_url: "",
  experience_years: 0,
  notice_period: "",
  current_ctc: "",
  expected_ctc: "",
  work_authorization: "",
  education_summary: "",
  match_threshold: 70,
  auto_apply_enabled: false,
  daily_attempt_cap: 20,
  password_set: false,
  ready: false,
  missing_fields: [],
};

const TEXT_FIELDS = [
  { key: "full_name", label: "Full name", required: true },
  { key: "email", label: "Email", type: "email", required: true },
  { key: "phone", label: "Phone", type: "tel", required: true },
  { key: "current_location", label: "Current city" },
  { key: "linkedin_url", label: "LinkedIn URL" },
  { key: "naukri_url", label: "Naukri profile URL" },
  { key: "notice_period", label: "Notice period" },
  { key: "current_ctc", label: "Current CTC" },
  { key: "expected_ctc", label: "Expected CTC" },
  { key: "work_authorization", label: "Work authorization" },
];

const MISSING_LABELS = { full_name: "full name", email: "email", phone: "phone" };

function pickForm(vault) {
  return Object.fromEntries(Object.keys(EMPTY).map((k) => [k, vault?.[k] ?? EMPTY[k]]));
}

function payload(form, extra = {}) {
  const body = {
    full_name: form.full_name,
    email: form.email,
    phone: form.phone,
    current_location: form.current_location,
    linkedin_url: form.linkedin_url,
    naukri_url: form.naukri_url,
    experience_years: Number(form.experience_years) || 0,
    notice_period: form.notice_period,
    current_ctc: form.current_ctc,
    expected_ctc: form.expected_ctc,
    work_authorization: form.work_authorization,
    education_summary: form.education_summary,
    match_threshold: Math.min(100, Math.max(0, Number(form.match_threshold) || 0)),
    daily_attempt_cap: Math.min(20, Math.max(1, Number(form.daily_attempt_cap) || 20)),
    auto_apply_enabled: Boolean(form.auto_apply_enabled),
    ...extra,
  };
  if (form.default_password) body.default_password = form.default_password;
  return body;
}

export function AutoApplySettings() {
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setForm(pickForm(await api.getApplyVault()));
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function save(extra = {}, okText = "Saved.") {
    setBusy("save");
    setError("");
    setMessage("");
    try {
      const saved = pickForm(await api.saveApplyVault(payload(form, extra)));
      setForm({ ...saved, default_password: "" });
      setMessage(okText);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function applyNow() {
    setBusy("run");
    setError("");
    setMessage("");
    try {
      await api.startAutoApply();
      setMessage("Auto-apply started. Follow it in Activity.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  if (!form) return <p className="muted">Loading…</p>;

  const missing = ["full_name", "email", "phone"].filter((k) => !String(form[k] || "").trim()).map((k) => MISSING_LABELS[k] || k);
  const ready = missing.length === 0;

  return (
    <div className="stack">
      <p className="muted small">
        Applies on your behalf to matching Naukri and LinkedIn Easy Apply jobs. Portals may limit accounts that look automated, so
        keep this to your personal account and review anything that lands in{" "}
        <Link to="/needs-help">Needs help</Link>.
      </p>
      <p className="muted small">Max 20 attempts/day. Naukri &amp; LinkedIn Easy Apply only in this version.</p>

      <Toggle
        checked={form.auto_apply_enabled}
        disabled={busy !== "" || (!form.auto_apply_enabled && !ready)}
        onChange={(v) => save({ auto_apply_enabled: v }, v ? "Auto-apply enabled." : "Auto-apply turned off.")}
        label="Auto-apply to matching jobs"
        description={
          form.auto_apply_enabled
            ? `Applies when match is at least ${form.match_threshold}%. Cap ${form.daily_attempt_cap}/day.`
            : ready
              ? "Off until you turn it on."
              : `Fill required fields first${missing.length ? `: ${missing.join(", ")}` : ""}.`
        }
      />

      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
      >
        <Field label="Match threshold" hint="Only jobs at or above this match score are queued.">
          {(id) => (
            <div className="row gap">
              <input
                id={id}
                type="range"
                min="0"
                max="100"
                value={form.match_threshold}
                onChange={(e) => set("match_threshold")(Number(e.target.value))}
              />
              <input
                className="num-sm"
                type="number"
                inputMode="numeric"
                min="0"
                max="100"
                aria-label="Match threshold percent"
                value={form.match_threshold}
                onChange={(e) => set("match_threshold")(e.target.value)}
              />
            </div>
          )}
        </Field>
        <Field label="Daily attempt cap" hint="Hard maximum is 20 Easy Apply / submit clicks per day.">
          {(id) => (
            <input
              id={id}
              className="num-sm"
              type="number"
              inputMode="numeric"
              min="1"
              max="20"
              value={form.daily_attempt_cap}
              onChange={(e) => set("daily_attempt_cap")(e.target.value)}
            />
          )}
        </Field>

        <h3>Apply vault</h3>
        <p className="muted small">
          {form.ready ? (
            <span className="badge badge-green">Vault ready</span>
          ) : (
            <span className="badge badge-orange">Vault incomplete</span>
          )}{" "}
          Used to fill Easy Apply fields. We never guess salary or notice period.
        </p>
        <div className="grid-2">
          {TEXT_FIELDS.map((f) => (
            <Field key={f.key} label={f.required ? `${f.label} *` : f.label}>
              {(id) => (
                <input
                  id={id}
                  type={f.type || "text"}
                  required={f.required}
                  value={form[f.key]}
                  onChange={(e) => set(f.key)(e.target.value)}
                />
              )}
            </Field>
          ))}
          <Field label="Years of experience">
            {(id) => (
              <input
                id={id}
                type="number"
                min="0"
                max="60"
                step="0.5"
                inputMode="decimal"
                value={form.experience_years}
                onChange={(e) => set("experience_years")(e.target.value)}
              />
            )}
          </Field>
        </div>
        <Field label="Education summary">
          {(id) => (
            <textarea
              id={id}
              rows={3}
              value={form.education_summary}
              onChange={(e) => set("education_summary")(e.target.value)}
            />
          )}
        </Field>
        <Field
          label="Default portal password"
          hint={
            form.password_set
              ? "A password is already stored. Leave blank to keep it; we never show the saved value."
              : "Optional in this version. Stored encrypted for later portal logins — never shown again."
          }
        >
          {(id) => (
            <input
              id={id}
              type="password"
              autoComplete="new-password"
              value={form.default_password || ""}
              onChange={(e) => set("default_password")(e.target.value)}
            />
          )}
        </Field>
        <div className="row gap wrap">
          <Button type="submit" variant="secondary" busy={busy === "save"}>
            Save auto-apply
          </Button>
          <Button type="button" variant="ghost" disabled={!form.auto_apply_enabled} busy={busy === "run"} onClick={applyNow}>
            Apply now
          </Button>
        </div>
      </form>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{message}</Alert>
    </div>
  );
}
