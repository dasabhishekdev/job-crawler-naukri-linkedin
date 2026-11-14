import { useEffect, useState } from "react";
import { api } from "./api";

export function SettingsPanel() {
  const [settings, setSettings] = useState(null);
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o");
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [verified, setVerified] = useState(false);

  function applySettings(data, { keepModel = false } = {}) {
    setSettings(data);
    setVerified(Boolean(data.verified));
    if (!keepModel) {
      setModel(data.model || data.recommended_model || "gpt-4o");
    }
  }

  async function loadSettings() {
    try {
      const data = await api.getOpenAiSettings();
      applySettings(data);
      if (data.configured) {
        setChecking(true);
        const checked = await api.checkOpenAiKey();
        applySettings(checked);
        setMessage(checked.message || "Saved key works. Choose a model, then save it for the agent.");
      }
    } catch (err) {
      setError(err.message);
      setVerified(false);
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    loadSettings();
  }, []);

  async function handleCheckKey(e) {
    e.preventDefault();
    setChecking(true);
    setError("");
    setMessage("");
    try {
      const payload = {};
      if (apiKey.trim()) payload.api_key = apiKey.trim();
      const checked = await api.checkOpenAiKey(payload);
      applySettings(checked);
      setApiKey("");
      setMessage(checked.message);
    } catch (err) {
      setVerified(false);
      setError(err.message);
    } finally {
      setChecking(false);
    }
  }

  async function handleSaveModel(e) {
    e.preventDefault();
    if (!verified) {
      setError("Check the API key first, then choose a model.");
      return;
    }
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const saved = await api.saveOpenAiSettings({ model });
      applySettings(saved, { keepModel: true });
      setModel(saved.model || model);
      setMessage(saved.message || `Agent will use ${saved.model}.`);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const models = settings?.models || [];
  const chipClass = verified ? "ok" : settings?.configured ? "warn" : "warn";
  const chipLabel = verified
    ? `Key works · ${settings?.masked_key || ""}`
    : settings?.configured
      ? "Key saved — check it"
      : "Key not configured";

  return (
    <section className="settings-page">
      <header className="settings-page-hero">
        <div>
          <p className="mission-kicker">OpenAI</p>
          <h2>Agent settings</h2>
          <p className="settings-hint">
            1. Paste the key and check it. 2. Pick a model this key can actually call. 3. Save that model for the agent.
          </p>
        </div>
        <div className={`settings-status-chip ${chipClass}`}>{chipLabel}</div>
      </header>

      <form className="settings-form" onSubmit={handleCheckKey}>
        <label className="settings-field">
          <span>API key</span>
          <div className="settings-key-row">
            <input
              type="password"
              autoComplete="off"
              placeholder={settings?.masked_key ? "Paste a new key, or check the saved one" : "sk-…"}
              value={apiKey}
              onChange={(e) => {
                setApiKey(e.target.value);
                setVerified(false);
                setMessage("");
              }}
              aria-label="OpenAI API key"
            />
            <button type="submit" disabled={checking || saving}>
              {checking ? "Checking…" : "Check key"}
            </button>
          </div>
        </label>
      </form>

      <form className="settings-form" onSubmit={handleSaveModel}>
        <fieldset className="model-fieldset" disabled={!verified || checking}>
          <legend>Model</legend>
          <p className="settings-hint">
            {verified
              ? "These models were returned for this key. GPT-4o is recommended when it is listed."
              : "Check the key first. The model list is loaded from OpenAI, not guessed."}
          </p>
          {verified ? (
            models.length === 0 ? (
              <p className="settings-error">No chat models came back for this key.</p>
            ) : (
              <div className="model-grid">
                {models.map((option) => {
                  const selected = model === option.id;
                  return (
                    <label
                      key={option.id}
                      className={`model-card ${selected ? "selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="openai-model"
                        value={option.id}
                        checked={selected}
                        onChange={() => setModel(option.id)}
                      />
                      <span className="model-card-top">
                        <strong>{option.label}</strong>
                        {option.tag ? <em>{option.tag}</em> : null}
                      </span>
                      <span className="model-card-blurb">{option.blurb}</span>
                    </label>
                  );
                })}
              </div>
            )
          ) : (
            <p className="settings-hint">No models yet. Check the key first — OpenAI will return what this account can call.</p>
          )}
        </fieldset>

        <div className="settings-form-actions">
          <button type="submit" disabled={!verified || saving || checking || !model}>
            {saving ? "Saving…" : "Save model for agent"}
          </button>
          {error ? <p className="settings-error">{error}</p> : null}
          {message ? <p className="settings-ok">{message}</p> : null}
        </div>
      </form>
    </section>
  );
}
