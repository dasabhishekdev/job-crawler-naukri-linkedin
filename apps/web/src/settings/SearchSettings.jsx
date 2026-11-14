import { useEffect, useState } from "react";
import { api } from "../api";
import { Alert, Button, Field, Toggle } from "../components/ui";

const NUMBERS = [
  { key: "searches_per_run", label: "AI searches per run", hint: "Each AI search runs 3 of the planned keywords.", min: 1, max: 6 },
  { key: "jobs_per_search", label: "Jobs per keyword", min: 3, max: 15 },
  { key: "career_pages_per_run", label: "Career pages per run", hint: "The most stale company pages are crawled first.", min: 1, max: 25 },
  { key: "max_job_age_days", label: "Ignore postings older than (days)", min: 1, max: 60 },
  { key: "min_match_to_sheet", label: "Min match % for the Google Sheet", min: 0, max: 100 },
  {
    key: "daily_token_budget",
    label: "Daily AI token budget",
    hint: "0 = unlimited. When reached, AI steps pause until tomorrow; career-page crawling continues.",
    min: 0,
    max: 50000000,
    step: 100000,
  },
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
      <Toggle checked={form.career_pages} onChange={(v) => save({ career_pages: v })} disabled={busy} label="Target company career pages" description="Read company job pages directly, without AI where possible." />
      <Toggle
        checked={form.discover_companies}
        onChange={(v) => save({ discover_companies: v })}
        disabled={busy || !form.career_pages}
        label="Discover new companies"
        description={`Once a day the AI finds companies that hire for your profile and adds their verified career pages (up to ${form.max_companies}).`}
      />
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
                <input id={id} type="number" inputMode="numeric" min={n.min} max={n.max} step={n.step || 1} value={form[n.key]} onChange={(e) => setForm({ ...form, [n.key]: e.target.value })} />
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
