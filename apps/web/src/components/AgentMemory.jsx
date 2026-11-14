import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Alert, Button, Empty, timeAgo } from "./ui";

const SECTIONS = [
  { id: "companies", label: "Companies" },
  { id: "keywords", label: "Keywords" },
  { id: "visited", label: "Visited pages" },
];

const STATUS_TONE = { ok: "badge-green", error: "badge-red", not_found: "badge-orange", blocked: "badge-orange" };

function Companies({ companies, lastDiscovery }) {
  if (!companies.length) return <Empty title="No companies yet">The agent finds companies and their career pages during searches.</Empty>;
  const ai = companies.filter((c) => c.source === "ai").length;
  return (
    <div className="stack-sm">
      <p className="muted small">
        {companies.length} companies ({ai} found by AI){lastDiscovery ? ` · last discovery ${timeAgo(lastDiscovery)}` : ""}. Manage them in Settings →
        Target companies.
      </p>
      <ul className="list card">
        {companies.map((c) => (
          <li key={c.id} className="list-row">
            <div className="grow min0">
              <p className="strong">
                {c.name || c.url} {c.source === "ai" ? <span className="badge badge-blue">AI found</span> : null}{" "}
                {c.ats ? <span className="badge">{c.ats}</span> : null} {!c.enabled ? <span className="badge">off</span> : null}
              </p>
              {c.reason ? <p className="muted small">{c.reason}</p> : null}
              <p className="muted small truncate">
                {c.total_found} jobs found in total
                {c.last_crawled_at ? ` · ${c.last_found} last time · crawled ${timeAgo(c.last_crawled_at)}` : " · not crawled yet"}
                {c.last_error ? ` · ${c.last_error}` : ""}
              </p>
            </div>
            <a className="btn btn-ghost btn-sm" href={c.url} target="_blank" rel="noreferrer noopener">
              Careers page
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Keywords({ queries, planAt, onChange }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function run(label, fn) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await fn();
      await onChange();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  const groups = [
    { kind: "jobs", title: "Job search keywords" },
    { kind: "companies", title: "Company discovery searches" },
  ];

  return (
    <div className="stack">
      <div className="row gap wrap">
        <p className="muted small grow">
          The AI plans these from your profile{planAt ? ` (last planned ${timeAgo(planAt)})` : ""}, then favours the ones that find good jobs and retires
          the ones that find nothing.
        </p>
        <Button variant="ghost" className="btn-sm" busy={busy === "plan"} onClick={() => run("plan", async () => setMessage((await api.refreshPlan()).message))}>
          Re-plan keywords
        </Button>
      </div>
      <form
        className="row gap wrap"
        onSubmit={(e) => {
          e.preventDefault();
          run("add", async () => {
            await api.addQuery(text);
            setText("");
          });
        }}
      >
        <input className="grow" aria-label="New search keyword" placeholder="Add your own keyword, e.g. SAP Ariba jobs Bengaluru" value={text} onChange={(e) => setText(e.target.value)} />
        <Button type="submit" variant="secondary" busy={busy === "add"} disabled={text.trim().length < 2}>
          Add
        </Button>
      </form>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{message}</Alert>
      {groups.map((g) => {
        const list = queries.filter((q) => q.kind === g.kind);
        if (!list.length) return null;
        return (
          <div key={g.kind} className="stack-sm">
            <h3>{g.title}</h3>
            <ul className="list card">
              {list.map((q) => (
                <li key={q.id} className={`list-row wrap ${q.retired ? "is-retired" : ""}`}>
                  <div className="grow min0">
                    <p className="strong">
                      {q.text} {q.origin === "user" ? <span className="badge badge-blue">yours</span> : null}{" "}
                      {q.retired ? <span className="badge">retired</span> : null}
                    </p>
                    <p className="muted small">
                      {q.uses ? `${q.uses} searches · ${q.new_jobs} new ${g.kind === "jobs" ? "jobs" : "companies"} · ${q.good_matches} good matches` : "Not used yet"}
                      {q.last_used_at ? ` · used ${timeAgo(q.last_used_at)}` : ""}
                      {q.why ? ` · ${q.why}` : ""}
                    </p>
                  </div>
                  <button type="button" className="link-btn" onClick={() => run(q.id, () => api.setQueryRetired(q.id, !q.retired))}>
                    {q.retired ? "Use again" : "Retire"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
      {!queries.length ? <Empty title="No keywords yet">They are planned at the start of the next search.</Empty> : null}
    </div>
  );
}

function Visited({ visited, totals }) {
  if (!visited.length) return <Empty title="Nothing visited yet">Every careers page and job page the agent opens is remembered here.</Empty>;
  return (
    <div className="stack-sm">
      <p className="muted small">
        {totals.pages} pages on {totals.domains} sites, {totals.visits} visits. Pages are remembered for 90 days so the agent does not re-read jobs it already
        has, and backs off from sites that keep failing.
      </p>
      <ul className="list card">
        {visited.map((v) => (
          <li key={v.url} className="list-row">
            <div className="grow min0">
              <a className="small truncate" href={v.url} target="_blank" rel="noreferrer noopener">
                {v.url.replace(/^https?:\/\//, "")}
              </a>
              <p className="muted small">
                {v.kind} · {v.visits} visit{v.visits > 1 ? "s" : ""} · {v.jobs_found} job{v.jobs_found === 1 ? "" : "s"} · {timeAgo(v.last_at)}
                {v.note ? ` · ${v.note}` : ""}
              </p>
            </div>
            <span className={`badge ${STATUS_TONE[v.last_status] || ""}`}>{v.last_status.replace("_", " ")}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** What the agent remembers: companies it found, search keywords and their yield, and pages it visited. */
export function AgentMemory() {
  const [section, setSection] = useState("companies");
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api.getMemory());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="stack">
      <div className="segmented" role="tablist" aria-label="Agent memory">
        {SECTIONS.map((s) => (
          <button key={s.id} type="button" role="tab" aria-selected={section === s.id} className={section === s.id ? "is-active" : ""} onClick={() => setSection(s.id)}>
            {s.label}
          </button>
        ))}
      </div>
      <Alert tone="error">{error}</Alert>
      {!data ? (
        <p className="muted">Loading…</p>
      ) : section === "companies" ? (
        <Companies companies={data.companies} lastDiscovery={data.last_company_discovery_at} />
      ) : section === "keywords" ? (
        <Keywords queries={data.queries} planAt={data.plan_generated_at} onChange={load} />
      ) : (
        <Visited visited={data.visited} totals={data.totals} />
      )}
    </div>
  );
}
