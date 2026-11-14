import { useEffect, useState } from "react";
import { api } from "../api";
import { Alert, Button, Field, formatDateTime } from "../components/ui";

const PROVIDERS = [
  {
    id: "cursor",
    name: "Cursor",
    blurb: "Cursor agents search the web and career pages. Best coverage.",
    keyUrl: "https://cursor.com/dashboard/integrations",
    keyLabel: "Cursor API key",
  },
  {
    id: "openai",
    name: "OpenAI",
    blurb: "GPT models with built-in web search. Fast scoring and resume writing.",
    keyUrl: "https://platform.openai.com/api-keys",
    keyLabel: "OpenAI API key",
  },
];

function ProviderPanel({ meta, keyInfo, isActive, model, onSaved }) {
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState([]);
  const [selected, setSelected] = useState(model || "");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => setSelected(model || ""), [model]);

  useEffect(() => {
    if (!keyInfo.configured || keyInfo.error) return;
    api.listModels(meta.id).then((d) => setModels(d.models)).catch(() => setModels([]));
  }, [meta.id, keyInfo.configured, keyInfo.error]);

  async function run(label, fn) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  return (
    <div className={`provider ${isActive ? "is-active" : ""}`}>
      <div className="provider-head">
        <div>
          <h3>
            {meta.name} {isActive ? <span className="badge badge-blue">Active</span> : null}
          </h3>
          <p className="muted small">{meta.blurb}</p>
        </div>
        {keyInfo.configured ? (
          <span className={`badge ${keyInfo.error ? "badge-red" : "badge-green"}`}>
            {keyInfo.error ? "Key rejected" : `Key ••••${keyInfo.last4}`}
          </span>
        ) : (
          <span className="badge">No key</span>
        )}
      </div>

      {keyInfo.error ? <Alert tone="error">{keyInfo.error}</Alert> : null}

      <form
        className="inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          run("save", async () => {
            const data = await api.saveAiKey(meta.id, apiKey);
            setApiKey("");
            setModels(data.models || []);
            setMessage("Key verified and saved.");
            onSaved(data);
          });
        }}
      >
        <Field
          label={keyInfo.configured ? `Replace ${meta.keyLabel}` : meta.keyLabel}
          hint={
            <>
              Get one at{" "}
              <a href={meta.keyUrl} target="_blank" rel="noreferrer">
                {new URL(meta.keyUrl).host}
              </a>
              . Stored encrypted; only the last 4 characters are ever shown.
            </>
          }
        >
          {(id) => (
            <input id={id} type="password" autoComplete="off" spellCheck="false" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste key" />
          )}
        </Field>
        <Button type="submit" busy={busy === "save"} disabled={apiKey.trim().length < 10}>
          Verify &amp; save
        </Button>
      </form>

      {keyInfo.configured && !keyInfo.error ? (
        <div className="provider-models">
          <Field
            label="Model"
            hint={`${meta.id === "cursor" ? "Composer 2.5 and Grok are covered by paid Cursor plans' weekly pool; Composer 2.5 uses it slowest. " : ""}${keyInfo.verified_at ? `Key verified ${formatDateTime(keyInfo.verified_at)}.` : ""}`}
          >
            {(id) => (
              <select id={id} value={selected} onChange={(e) => setSelected(e.target.value)}>
                {[...new Set([selected, ...models.map((m) => m.id)].filter(Boolean))].map((idValue) => {
                  const m = models.find((x) => x.id === idValue);
                  const note = m?.included_in_plan
                    ? " · included in Cursor plan"
                    : m?.known
                      ? ` · $${m.input} in / $${m.output} out per 1M tokens`
                      : "";
                  return (
                    <option key={idValue} value={idValue}>
                      {(m?.label || idValue) + note}
                    </option>
                  );
                })}
              </select>
            )}
          </Field>
          <div className="row gap">
            <Button
              busy={busy === "use"}
              disabled={!selected || (isActive && selected === model)}
              onClick={() =>
                run("use", async () => {
                  onSaved(await api.saveAi(meta.id, selected));
                  setMessage(isActive ? "Model updated." : `${meta.name} is now used for all AI work.`);
                })
              }
            >
              {isActive ? "Save model" : `Use ${meta.name}`}
            </Button>
            <Button variant="ghost" busy={busy === "remove"} onClick={() => run("remove", async () => onSaved(await api.deleteAiKey(meta.id)))}>
              Remove key
            </Button>
          </div>
        </div>
      ) : keyInfo.configured ? (
        <Button variant="ghost" busy={busy === "remove"} onClick={() => run("remove", async () => onSaved(await api.deleteAiKey(meta.id)))}>
          Remove key
        </Button>
      ) : null}

      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{message}</Alert>
    </div>
  );
}

export function AiSettings({ settings, onChange }) {
  if (!settings) return null;
  const { ai } = settings;
  return (
    <div className="stack">
      <p className="muted">
        Choose the AI that reads your resume, searches for jobs, scores them and writes tailored resumes. You pay your provider
        directly for usage.
      </p>
      {PROVIDERS.map((meta) => (
        <ProviderPanel
          key={meta.id}
          meta={meta}
          keyInfo={ai.keys[meta.id]}
          isActive={ai.provider === meta.id}
          model={ai.models?.[meta.id]}
          onSaved={onChange}
        />
      ))}
    </div>
  );
}
