import { useEffect, useId, useRef, useState } from "react";

export function Button({ variant = "primary", busy = false, children, className = "", ...props }) {
  return (
    <button className={`btn btn-${variant} ${className}`} disabled={busy || props.disabled} {...props}>
      {busy ? <span className="spinner" aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

export function Field({ label, hint, error, children }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {typeof children === "function" ? children(id) : children}
      {hint && !error ? <p className="field-hint">{hint}</p> : null}
      {error ? <p className="field-error" role="alert">{error}</p> : null}
    </div>
  );
}

export function Alert({ tone = "info", children }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${tone}`} role={tone === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Toggle({ checked, onChange, label, description, disabled }) {
  return (
    <label className={`toggle ${disabled ? "is-disabled" : ""}`}>
      <span className="toggle-text">
        <span className="toggle-label">{label}</span>
        {description ? <span className="toggle-desc">{description}</span> : null}
      </span>
      <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track" aria-hidden="true" />
    </label>
  );
}

export function TagInput({ id, value = [], onChange, placeholder, max = 20 }) {
  const [draft, setDraft] = useState("");
  function add(raw) {
    const items = raw.split(",").map((s) => s.trim()).filter(Boolean);
    if (!items.length) return;
    const next = [...value];
    for (const item of items) if (!next.some((v) => v.toLowerCase() === item.toLowerCase()) && next.length < max) next.push(item);
    onChange(next);
    setDraft("");
  }
  return (
    <div className="tag-input">
      {value.map((tag) => (
        <span className="tag" key={tag}>
          {tag}
          <button type="button" aria-label={`Remove ${tag}`} onClick={() => onChange(value.filter((t) => t !== tag))}>
            ×
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        placeholder={value.length >= max ? "" : placeholder}
        disabled={value.length >= max}
        onChange={(e) => (e.target.value.endsWith(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(draft)}
      />
    </div>
  );
}

const APPLY_STATUS = {
  applied: { label: "Applied", tone: "badge-green" },
  needs_help: { label: "Needs help", tone: "badge-orange" },
  queued: { label: "Queued", tone: "badge-blue" },
  classifying: { label: "Applying…", tone: "badge-blue" },
  authenticating: { label: "Applying…", tone: "badge-blue" },
  mapping_fields: { label: "Applying…", tone: "badge-blue" },
  executing: { label: "Applying…", tone: "badge-blue" },
  failed: { label: "Apply failed", tone: "badge-red" },
  skipped_cap: { label: "Daily cap", tone: "" },
};

export function ApplyBadge({ status }) {
  const s = APPLY_STATUS[status];
  if (!s) return null;
  return <span className={`badge ${s.tone}`}>{s.label}</span>;
}

export function ScorePill({ value, label, good = 70, ok = 50 }) {
  if (value === null || value === undefined) return <span className="pill pill-muted">{label ? `${label} —` : "—"}</span>;
  const tone = value >= good ? "good" : value >= ok ? "ok" : "low";
  return (
    <span className={`pill pill-${tone}`}>
      {label ? `${label} ` : ""}
      {value}%
    </span>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <p className="empty-title">{title}</p>
      {children ? <p className="empty-body">{children}</p> : null}
      {action}
    </div>
  );
}

export function Card({ title, actions, children, className = "" }) {
  return (
    <section className={`card ${className}`}>
      {title || actions ? (
        <header className="card-head">
          {title ? <h2>{title}</h2> : <span />}
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Sheet({ open, onClose, title, children }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    ref.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref} onClick={(e) => e.stopPropagation()}>
        <header className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function timeAgo(value) {
  if (!value) return "";
  const diff = Date.now() - new Date(value).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 30 ? `${d}d ago` : new Date(value).toLocaleDateString();
}

export function formatDateTime(value) {
  return value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";
}
