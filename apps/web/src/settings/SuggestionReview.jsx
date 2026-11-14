import { useEffect, useState } from "react";
import { api } from "../api";
import { Alert, Button, timeAgo } from "../components/ui";

function defaultChoices(changes) {
  return Object.fromEntries(changes.map((c) => [c.field, { selected: true, mode: c.list ? "add" : "replace" }]));
}

function Value({ value }) {
  if (value === "" || value === null || value === undefined) return <span className="muted">empty</span>;
  return <span>{String(value)}</span>;
}

function ListChange({ change, mode }) {
  return (
    <div className="chips">
      {change.added.map((item) => (
        <span key={`+${item}`} className="chip chip-good">
          + {item}
        </span>
      ))}
      {mode === "replace"
        ? change.removed.map((item) => (
            <span key={`-${item}`} className="chip chip-removed">
              − {item}
            </span>
          ))
        : null}
    </div>
  );
}

/** Lets the user review the AI-analysed profile and apply all or some of it. */
export function SuggestionReview({ suggestion, onApplied }) {
  const changes = suggestion?.changes || [];
  const [choices, setChoices] = useState(() => defaultChoices(changes));
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  useEffect(() => setChoices(defaultChoices(suggestion?.changes || [])), [suggestion]);

  if (!changes.length) return null;

  const set = (field, patch) => setChoices((prev) => ({ ...prev, [field]: { ...prev[field], ...patch } }));
  const selected = changes.filter((c) => choices[c.field]?.selected);

  async function apply(list) {
    setBusy(list === changes ? "all" : "some");
    setError("");
    try {
      const fields = Object.fromEntries(list.map((c) => [c.field, choices[c.field]?.mode || "replace"]));
      onApplied(await api.applySuggestion(fields));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  async function dismiss() {
    setBusy("dismiss");
    setError("");
    try {
      onApplied(await api.dismissSuggestion());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="card suggestion" aria-label="Analysed profile">
      <header className="card-head">
        <div>
          <h2>Review analysed profile</h2>
          <p className="muted small">
            AI read your resume {suggestion.at ? timeAgo(suggestion.at) : "again"} and suggests {changes.length} change
            {changes.length > 1 ? "s" : ""}. Choose what to apply; nothing changes until you do.
          </p>
        </div>
      </header>

      <ul className="suggestion-list">
        {changes.map((c) => {
          const choice = choices[c.field] || {};
          return (
            <li key={c.field} className={choice.selected ? "is-selected" : ""}>
              <label className="suggestion-pick">
                <input type="checkbox" checked={Boolean(choice.selected)} onChange={(e) => set(c.field, { selected: e.target.checked })} />
                <span className="strong">{c.label}</span>
              </label>
              {c.list ? (
                <>
                  <ListChange change={c} mode={choice.mode} />
                  <div className="segmented" role="radiogroup" aria-label={`How to apply ${c.label}`}>
                    <button type="button" role="radio" aria-checked={choice.mode === "add"} className={choice.mode === "add" ? "is-active" : ""} onClick={() => set(c.field, { mode: "add", selected: true })}>
                      Add {c.added.length} new
                    </button>
                    <button type="button" role="radio" aria-checked={choice.mode === "replace"} className={choice.mode === "replace" ? "is-active" : ""} onClick={() => set(c.field, { mode: "replace", selected: true })}>
                      Replace list
                    </button>
                  </div>
                </>
              ) : (
                <div className="suggestion-values">
                  <p>
                    <span className="suggestion-tag">Now</span> <Value value={c.current} />
                  </p>
                  <p>
                    <span className="suggestion-tag suggestion-tag-new">Suggested</span> <Value value={c.suggested} />
                  </p>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <Alert tone="error">{error}</Alert>
      <div className="row gap wrap">
        <Button busy={busy === "some"} disabled={!selected.length || Boolean(busy)} onClick={() => apply(selected)}>
          Apply selected ({selected.length})
        </Button>
        <Button variant="secondary" busy={busy === "all"} disabled={Boolean(busy)} onClick={() => apply(changes)}>
          Apply all
        </Button>
        <Button variant="ghost" busy={busy === "dismiss"} disabled={Boolean(busy)} onClick={dismiss}>
          Dismiss
        </Button>
      </div>
    </section>
  );
}
