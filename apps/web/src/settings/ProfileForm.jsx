import { useEffect, useState } from "react";
import { api } from "../api";
import { Alert, Button, Field, TagInput, Toggle } from "../components/ui";

const DEFAULTS = {
  full_name: "",
  headline: "",
  phone: "",
  current_location: "",
  summary: "",
  experience_years: 0,
  target_roles: [],
  skills: [],
  target_locations: [],
  remote_ok: false,
  exclude_companies: [],
};

function pick(profile) {
  return Object.fromEntries(Object.entries(DEFAULTS).map(([f, fallback]) => [f, profile?.[f] ?? fallback]));
}

export function ProfileForm({ profile, onSaved, submitLabel = "Save profile", compact = false }) {
  const [form, setForm] = useState(() => pick(profile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => setForm(pick(profile)), [profile]);

  const set = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const { profile: saved } = await api.saveProfile({ ...form, experience_years: Number(form.experience_years) || 0 });
      setMessage("Profile saved.");
      onSaved?.(saved);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="stack" onSubmit={submit}>
      <Field label="Target roles" hint="Job titles to search for. Press Enter after each one.">
        {(id) => <TagInput id={id} value={form.target_roles || []} onChange={set("target_roles")} placeholder="e.g. Procurement Analyst" max={15} />}
      </Field>
      <div className="grid-2">
        <Field label="Cities to search" hint="Press Enter after each city.">
          {(id) => <TagInput id={id} value={form.target_locations || []} onChange={set("target_locations")} placeholder="e.g. Bengaluru" max={8} />}
        </Field>
        <Field label="Years of experience">
          {(id) => (
            <input id={id} type="number" min="0" max="60" step="0.5" inputMode="decimal" value={form.experience_years} onChange={(e) => set("experience_years")(e.target.value)} />
          )}
        </Field>
      </div>
      <Toggle checked={Boolean(form.remote_ok)} onChange={set("remote_ok")} label="Include remote jobs" />
      <Field label="Key skills">
        {(id) => <TagInput id={id} value={form.skills || []} onChange={set("skills")} placeholder="e.g. Excel, SAP, Vendor management" max={40} />}
      </Field>
      {!compact ? (
        <>
          <Field label="Companies to exclude" hint="For example your current employer.">
            {(id) => <TagInput id={id} value={form.exclude_companies || []} onChange={set("exclude_companies")} placeholder="Company name" max={50} />}
          </Field>
          <div className="grid-2">
            <Field label="Full name">{(id) => <input id={id} value={form.full_name} onChange={(e) => set("full_name")(e.target.value)} />}</Field>
            <Field label="Current city">{(id) => <input id={id} value={form.current_location} onChange={(e) => set("current_location")(e.target.value)} />}</Field>
          </div>
          <div className="grid-2">
            <Field label="Headline">{(id) => <input id={id} value={form.headline} onChange={(e) => set("headline")(e.target.value)} />}</Field>
            <Field label="Phone">{(id) => <input id={id} type="tel" value={form.phone} onChange={(e) => set("phone")(e.target.value)} />}</Field>
          </div>
          <Field label="Summary">
            {(id) => <textarea id={id} rows={4} value={form.summary} onChange={(e) => set("summary")(e.target.value)} />}
          </Field>
        </>
      ) : null}
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{message}</Alert>
      <Button type="submit" busy={busy} disabled={!form.target_roles?.length}>
        {submitLabel}
      </Button>
    </form>
  );
}
