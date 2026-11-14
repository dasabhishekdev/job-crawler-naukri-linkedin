import { useEffect, useState } from "react";
import { api } from "../api";
import { Alert, Button, Field, Toggle } from "../components/ui";

const NUMBERS = [
  { key: "searches_per_run", label: "Searches per run", hint: "Each search covers 3 of your target roles.", min: 1, max: 6 },
  { key: "jobs_per_search", label: "Jobs per search", min: 3, max: 15 },
  { key: "max_job_age_days", label: "Ignore postings older than (days)", min: 1, max: 60 },
  { key: "min_match_to_sheet", label: "Min match % for the Google Sheet", min: 0, max: 100 },
];

export function SearchSettings({ settings, onChange }) {
  const [form, setForm] = useState(settings?.crawler);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => setForm(settings?.crawler), [settings]);
  if (!form) return null;

  async function save(patch) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      onChange(await api.saveCrawler(patch));
      setMessage("Saved.");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <Toggle
        checked={form.hourly_enabled}
        onChange={(v) => save({ hourly_enabled: v })}
        disabled={busy}
        label="Search every hour"
        description={`Runs at the top of every hour (up to ${form.daily_run_limit} runs a day).`}
      />
      <Toggle checked={form.web_search} onChange={(v) => save({ web_search: v })} disabled={busy} label="AI web search" description="Job boards, LinkedIn and Naukri listings, company sites." />
      <Toggle checked={form.career_pages} onChange={(v) => save({ career_pages: v })} disabled={busy} label="Target company career pages" description="Companies you list below." />
      <form
        className="stack"
        onSubmit={(e) => {
          e.preventDefault();
          save(Object.fromEntries(NUMBERS.map((n) => [n.key, Number(form[n.key])])));
        }}
      >
        <div className="grid-2">
          {NUMBERS.map((n) => (
            <Field key={n.key} label={n.label} hint={n.hint}>
              {(id) => (
                <input id={id} type="number" inputMode="numeric" min={n.min} max={n.max} value={form[n.key]} onChange={(e) => setForm({ ...form, [n.key]: e.target.value })} />
              )}
            </Field>
          ))}
        </div>
        <Button type="submit" variant="secondary" busy={busy}>
          Save search options
        </Button>
      </form>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{message}</Alert>
    </div>
  );
}
