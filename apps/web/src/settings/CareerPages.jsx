import { useEffect, useState } from "react";
import { api } from "../api";
import { Alert, Button, Toggle, timeAgo } from "../components/ui";

export function CareerPages({ profile, onSaved }) {
  const [pages, setPages] = useState(profile?.career_pages || []);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");

  useEffect(() => setPages(profile?.career_pages || []), [profile]);

  async function persist(next) {
    setError("");
    try {
      const data = await api.saveCareerPages(next.map(({ name: n, url: u, enabled }) => ({ name: n, url: u, enabled })));
      setPages(data.career_pages);
      onSaved?.(data.career_pages);
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="stack">
      <p className="muted small">
        Add companies you want to work for. Greenhouse, Lever and Ashby job boards are read directly; any other careers page is
        opened by the AI.
      </p>
      {pages.length ? (
        <ul className="list">
          {pages.map((page, i) => (
            <li key={`${page.url}-${i}`} className="list-row">
              <div className="grow min0">
                <Toggle
                  checked={page.enabled !== false}
                  onChange={(checked) => persist(pages.map((p, j) => (j === i ? { ...p, enabled: checked } : p)))}
                  label={page.name || new URL(page.url).host}
                  description={
                    page.last_error
                      ? `Error: ${page.last_error}`
                      : page.last_crawled_at
                        ? `${page.last_found || 0} matching roles · checked ${timeAgo(page.last_crawled_at)}`
                        : "Not checked yet"
                  }
                />
                <a className="small truncate" href={page.url} target="_blank" rel="noreferrer">
                  {page.url}
                </a>
              </div>
              <button type="button" className="icon-btn" aria-label={`Remove ${page.name || page.url}`} onClick={() => persist(pages.filter((_, j) => j !== i))}>
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">No companies yet.</p>
      )}
      <form
        className="row gap wrap"
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^https?:\/\//i.test(url.trim())) {
            setError("Enter the full careers URL, starting with https://");
            return;
          }
          persist([...pages, { name: name.trim(), url: url.trim(), enabled: true }]);
          setName("");
          setUrl("");
        }}
      >
        <input className="grow" aria-label="Company name" placeholder="Company" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="grow-2" aria-label="Careers page URL" placeholder="https://company.com/careers" inputMode="url" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button type="submit" variant="secondary">
          Add
        </Button>
      </form>
      <Alert tone="error">{error}</Alert>
    </div>
  );
}
