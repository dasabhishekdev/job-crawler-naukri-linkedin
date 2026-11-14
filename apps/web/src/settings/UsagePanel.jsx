import { useEffect, useState } from "react";
import { api } from "../api";
import { Alert, timeAgo } from "../components/ui";
import { KIND_LABELS } from "../components/LiveConsole";

const fmt = (n) => Number(n || 0).toLocaleString("en-US");
const usd = (n) => (n >= 0.01 ? `$${n.toFixed(2)}` : n > 0 ? `$${n.toFixed(4)}` : "$0");
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n || 0));
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Token usage for the signed-in user: today vs budget, the last 7 days, and where tokens went. */
export function UsagePanel({ refreshKey }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getUsage().then(setData).catch((err) => setError(err.message));
  }, [refreshKey]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return <p className="muted">Loading usage…</p>;

  const { today, last7 } = data;
  const pct = today.budget ? Math.min(100, Math.round((today.tokens / today.budget) * 100)) : 0;
  const maxDay = Math.max(1, ...last7.map((d) => d.tokens));
  const weekTokens = last7.reduce((n, d) => n + d.tokens, 0);
  const weekCost = last7.reduce((n, d) => n + d.cost, 0);
  const included = data.current?.included_in_plan;

  return (
    <div className="usage stack">
      <div className="usage-head">
        <div>
          <p className="usage-big">{fmt(today.tokens)}</p>
          <p className="muted small">tokens today{today.budget ? ` of ${fmt(today.budget)} daily budget` : " (no daily budget)"} · {plural(today.calls, "AI call")}</p>
        </div>
        <div className="usage-cost">
          <p className="strong">{included ? "Included in plan" : usd(today.est_cost_usd)}</p>
          <p className="muted small">{included ? `≈ ${usd(today.est_cost_usd)} at list price` : "estimated today"}</p>
        </div>
      </div>
      {today.budget ? (
        <div className={`meter ${pct >= 90 ? "is-high" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Daily budget used">
          <span style={{ width: `${pct}%` }} />
        </div>
      ) : null}

      <div>
        <p className="small strong">Last 7 days · {fmt(weekTokens)} tokens · ≈ {usd(weekCost)} at list price</p>
        <div className="usage-bars" aria-label="Tokens per day">
          {last7.map((d) => (
            <div key={d.day} className="usage-bar" title={`${d.day}: ${fmt(d.tokens)} tokens`}>
              <span style={{ height: `${Math.max(2, (d.tokens / maxDay) * 100)}%` }} />
              <small>{new Date(`${d.day}T12:00:00`).toLocaleDateString(undefined, { weekday: "short" })}</small>
            </div>
          ))}
        </div>
      </div>

      {data.by_purpose.length ? (
        <div className="stack-sm">
          <p className="small strong">Where tokens went (7 days)</p>
          <ul className="usage-list">
            {data.by_purpose.map((p) => (
              <li key={p.purpose}>
                <span className="grow truncate">{p.purpose}</span>
                <span className="muted small">{plural(p.calls, "call")}</span>
                <span className="strong small">{short(p.tokens)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.by_model.length ? (
        <div className="stack-sm">
          <p className="small strong">Models</p>
          <ul className="usage-list">
            {data.by_model.map((m) => (
              <li key={`${m.provider}-${m.model}`}>
                <span className="grow truncate">
                  {m.model} {m.included_in_plan ? <span className="badge badge-green">included in Cursor plan</span> : null}
                </span>
                <span className="strong small">{short(m.tokens)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.recent_runs.length ? (
        <div className="stack-sm">
          <p className="small strong">Recent runs</p>
          <ul className="usage-list">
            {data.recent_runs.map((r) => (
              <li key={r.run_id}>
                <span className="grow truncate">
                  {KIND_LABELS[r.kind] || r.kind || "Run"} · {timeAgo(r.at)}
                </span>
                <span className="muted small">{plural(r.calls, "call")}</span>
                <span className="strong small">{short(r.tokens)}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <p className="muted small">
        {data.note}{" "}
        {data.dashboard ? (
          <a href={data.dashboard.url} target="_blank" rel="noreferrer noopener">
            Open {data.dashboard.label}
          </a>
        ) : null}
      </p>
    </div>
  );
}
