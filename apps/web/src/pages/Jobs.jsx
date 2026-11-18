import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { usePoll, useLiveFeed } from "../hooks";
import { Alert, ApplyBadge, Button, Empty, ScorePill, Sheet, timeAgo } from "../components/ui";
import { JobDetail } from "./JobDetail";

const VIEWS = [
  { id: "inbox", label: "Inbox", count: (c) => (c.new || 0) + (c.saved || 0) },
  { id: "saved", label: "Saved", count: (c) => c.saved || 0 },
  { id: "applied", label: "Applied", count: (c) => c.applied || 0 },
  { id: "hidden", label: "Hidden", count: (c) => c.hidden || 0 },
];

const STAGE_TEXT = { search: "Searching job sites", score: "Scoring matches", sync: "Updating your sheet" };

function CrawlBanner({ run, onCancel }) {
  const { lines } = useLiveFeed({ runId: run?._id, enabled: Boolean(run?._id), limit: 5 });
  if (!run) return null;
  const latest = lines[lines.length - 1];
  return (
    <div className="banner">
      <span className="spinner" aria-hidden="true" />
      <div className="grow min0">
        <p className="strong">{run.status === "queued" ? "Job search queued" : STAGE_TEXT[run.stage] || "Searching…"}</p>
        <p className="muted small truncate" aria-live="polite">
          {latest?.message ||
            (run.counters?.found ? `${run.counters.found} postings found · ${run.counters.new || 0} new` : "This takes a few minutes. New jobs appear here automatically.")}
        </p>
        <Link className="small" to="/activity">
          Watch live
        </Link>
      </div>
      <button type="button" className="link-btn" onClick={onCancel}>
        Cancel
      </button>
    </div>
  );
}

function JobCard({ job, onOpen, onStatus }) {
  return (
    <article className={`job-card ${job.status === "new" ? "is-new" : ""}`}>
      <button type="button" className="job-card-main" onClick={onOpen}>
        <div className="job-card-top">
          <div className="min0">
            <h3 className="job-title">{job.title}</h3>
            <p className="job-meta">
              {job.company}
              {job.location ? ` · ${job.location}` : ""}
            </p>
          </div>
          <ScorePill value={job.match?.score} />
        </div>
        {job.match?.summary ? <p className="job-summary">{job.match.summary}</p> : <p className="job-summary muted">Scoring…</p>}
        <div className="job-card-foot">
          <span className="muted small">
            {job.source_site || "Web"} · {timeAgo(job.first_seen_at)}
          </span>
          {job.match?.ats_score !== undefined && job.match?.ats_score !== null ? <ScorePill value={job.match.ats_score} label="ATS" good={75} ok={55} /> : null}
          <ApplyBadge status={job.apply_status} />
          {job.latest_resume_id ? <span className="badge badge-green">Resume ready</span> : null}
        </div>
      </button>
      <div className="job-card-actions">
        <a className="btn btn-primary btn-sm" href={job.job_url} target="_blank" rel="noreferrer noopener">
          Apply
        </a>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onStatus(job.status === "saved" ? "new" : "saved")}>
          {job.status === "saved" ? "Saved ✓" : "Save"}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onStatus(job.status === "hidden" ? "new" : "hidden")}>
          {job.status === "hidden" ? "Unhide" : "Hide"}
        </button>
      </div>
    </article>
  );
}

export function JobsPage() {
  const [view, setView] = useState("inbox");
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [minMatch, setMinMatch] = useState("");
  const [jobs, setJobs] = useState([]);
  const [counts, setCounts] = useState({});
  const [nextBefore, setNextBefore] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [activeRun, setActiveRun] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const load = useCallback(
    async ({ append = false, before } = {}) => {
      try {
        const data = await api.listJobs({ view, q: query, min_match: minMatch, before, limit: 25 });
        setJobs((prev) => (append ? [...prev, ...data.jobs] : data.jobs));
        setCounts(data.counts);
        setNextBefore(data.next_before);
        setError("");
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    },
    [view, query, minMatch]
  );

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  usePoll(
    async () => {
      const { runs } = await api.activeRuns();
      const crawl = runs.find((r) => r.kind === "crawl") || null;
      if (activeRun && !crawl) load();
      setActiveRun(crawl);
    },
    activeRun ? 5000 : 30000
  );
  usePoll(() => load(), 20000, Boolean(activeRun));

  async function startSearch() {
    setStarting(true);
    setError("");
    try {
      const { run_id } = await api.startCrawl();
      setActiveRun({ _id: run_id, status: "queued" });
    } catch (err) {
      setError(err.message);
    } finally {
      setStarting(false);
    }
  }

  async function updateStatus(job, status) {
    try {
      await api.setJobStatus(job._id, status);
      load();
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Jobs</h1>
          <p className="muted small">Newest matches first, from every site we search.</p>
        </div>
        {!activeRun ? (
          <Button busy={starting} onClick={startSearch}>
            Search now
          </Button>
        ) : null}
      </header>

      <CrawlBanner run={activeRun} onCancel={() => api.cancelRun(activeRun._id).then(() => setActiveRun(null)).catch((e) => setError(e.message))} />

      <div className="tabs" role="tablist">
        {VIEWS.map((v) => (
          <button key={v.id} type="button" role="tab" aria-selected={view === v.id} className={view === v.id ? "is-active" : ""} onClick={() => setView(v.id)}>
            {v.label}
            <span className="tab-count">{v.count(counts)}</span>
          </button>
        ))}
      </div>

      <div className="filters">
        <input type="search" placeholder="Search title, company, city" aria-label="Search jobs" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Minimum match" value={minMatch} onChange={(e) => setMinMatch(e.target.value)}>
          <option value="">Any match</option>
          <option value="50">50%+ match</option>
          <option value="70">70%+ match</option>
          <option value="85">85%+ match</option>
        </select>
      </div>

      <Alert tone="error">{error}</Alert>

      {loading ? (
        <div className="skeleton-list" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="skeleton-card" />
          ))}
        </div>
      ) : jobs.length ? (
        <div className="job-list">
          {jobs.map((job) => (
            <JobCard key={job._id} job={job} onOpen={() => setOpenId(job._id)} onStatus={(s) => updateStatus(job, s)} />
          ))}
          {nextBefore ? (
            <Button variant="secondary" onClick={() => load({ append: true, before: nextBefore })}>
              Load more
            </Button>
          ) : null}
        </div>
      ) : (
        <Empty title={view === "inbox" ? "No jobs yet" : `Nothing in ${view}`}>
          {view === "inbox" ? (
            <>
              Click <strong>Search now</strong> to run your first search, or check your <Link to="/resume">profile</Link> target roles.
            </>
          ) : null}
        </Empty>
      )}

      <Sheet open={Boolean(openId)} onClose={() => setOpenId(null)} title="Job details">
        {openId ? <JobDetail jobId={openId} onStatusChange={() => load()} /> : null}
      </Sheet>
    </div>
  );
}
