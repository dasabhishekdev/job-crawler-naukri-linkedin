import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { Alert, Button, Toggle, timeAgo } from "../components/ui";
import { PortalLogin } from "../components/PortalLogin";

const STATUS = {
  connected: { label: "Connected", tone: "badge-green" },
  expired: { label: "Session expired", tone: "badge-orange" },
  disconnected: { label: "Not connected", tone: "" },
};

export function PortalSettings() {
  const [data, setData] = useState(null);
  const [loginPortal, setLoginPortal] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    try {
      setData(await api.getPortals());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function run(label, fn, okText) {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const result = await fn();
      if (result?.portals) setData(result);
      if (okText) setMessage(okText);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy("");
    }
  }

  if (!data) return <p className="muted">Loading…</p>;
  const anyConnected = data.portals.some((p) => p.status === "connected");
  const naukri = data.portals.find((p) => p.portal === "naukri");

  return (
    <div className="stack">
      <p className="muted small">
        Connect your own accounts to add each portal’s <strong>recommended jobs</strong> and logged-in search results. Searches run
        every 3 hours with human-like pacing. Portals may limit accounts that look automated, so keep it to your personal account.
      </p>
      <ul className="list">
        {data.portals.map((p) => {
          const s = STATUS[p.status] || STATUS.disconnected;
          return (
            <li key={p.portal} className="list-row wrap">
              <div className="grow min0">
                <p className="strong">
                  {p.label} <span className={`badge ${s.tone}`}>{s.label}</span>
                </p>
                <p className="muted small truncate">
                  {p.status === "connected"
                    ? `Connected ${timeAgo(p.connected_at)}${p.last_crawl_at ? ` · last searched ${timeAgo(p.last_crawl_at)}` : ""}`
                    : p.last_error || "Sign in once; we keep the session, never the password."}
                </p>
              </div>
              <div className="row gap">
                <Button variant={p.status === "connected" ? "ghost" : "primary"} className="btn-sm" onClick={() => setLoginPortal(p.portal)}>
                  {p.status === "disconnected" ? "Connect" : "Reconnect"}
                </Button>
                {p.status !== "disconnected" ? (
                  <Button variant="ghost" className="btn-sm" busy={busy === `rm-${p.portal}`} onClick={() => run(`rm-${p.portal}`, () => api.disconnectPortal(p.portal))}>
                    Disconnect
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <Toggle
        checked={data.settings.crawl_enabled}
        disabled={busy === "settings"}
        onChange={(v) => run("settings", () => api.savePortalSettings({ crawl_enabled: v }))}
        label="Search connected portals every 3 hours"
      />
      <Toggle
        checked={data.settings.naukri_profile_refresh}
        disabled={busy === "settings" || naukri?.status !== "connected"}
        onChange={(v) => run("settings", () => api.savePortalSettings({ naukri_profile_refresh: v }))}
        label="Refresh my Naukri profile daily"
        description={
          data.settings.last_naukri_refresh_at
            ? `Re-uploads your current resume at 9:15 AM. Last refreshed ${timeAgo(data.settings.last_naukri_refresh_at)}.`
            : "Re-uploads your current resume at 9:15 AM so recruiters see an updated profile."
        }
      />
      <div className="row gap wrap">
        <Button variant="secondary" disabled={!anyConnected} busy={busy === "crawl"} onClick={() => run("crawl", () => api.portalCrawl(), "Portal search started. Follow it in Activity.")}>
          Search portals now
        </Button>
        {naukri?.status === "connected" ? (
          <Button variant="ghost" busy={busy === "refresh"} onClick={() => run("refresh", () => api.naukriRefresh(), "Naukri profile refresh started.")}>
            Refresh Naukri profile now
          </Button>
        ) : null}
      </div>
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{message}</Alert>

      {loginPortal ? (
        <PortalLogin
          portal={loginPortal}
          onClose={() => {
            setLoginPortal(null);
            load();
          }}
          onConnected={load}
        />
      ) : null}
    </div>
  );
}
