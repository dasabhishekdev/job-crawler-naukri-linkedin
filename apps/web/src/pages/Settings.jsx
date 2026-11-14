import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Alert, Card } from "../components/ui";
import { AiSettings } from "../settings/AiSettings";
import { SearchSettings } from "../settings/SearchSettings";
import { CareerPages } from "../settings/CareerPages";
import { DriveSettings } from "../settings/DriveSettings";
import { AccountSettings } from "../settings/AccountSettings";
import { PortalSettings } from "../settings/PortalSettings";
import { UsagePanel } from "../settings/UsagePanel";

const DRIVE_NOTICES = {
  connected: "Google Drive connected. Your sheet is ready.",
  cancelled: "Google Drive connection was cancelled.",
  expired: "The Google connection took too long. Try again.",
  failed: "Could not connect Google Drive. Try again.",
};

export function SettingsPage() {
  const { refresh } = useAuth();
  const [params, setParams] = useSearchParams();
  const [settings, setSettings] = useState(null);
  const [profile, setProfile] = useState(null);
  const [error, setError] = useState("");
  const driveNotice = DRIVE_NOTICES[params.get("drive")];

  useEffect(() => {
    Promise.all([api.getSettings(), api.getProfile()])
      .then(([s, p]) => {
        setSettings(s);
        setProfile(p.profile);
      })
      .catch((err) => setError(err.message));
    if (params.get("drive")) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const update = (data) => {
    setSettings((prev) => ({ ...prev, ...data }));
    refresh();
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Settings</h1>
      </header>
      <Alert tone="error">{error}</Alert>
      <Card title="AI provider">
        <AiSettings settings={settings} onChange={update} />
      </Card>
      <Card title="AI usage">
        <UsagePanel refreshKey={settings?.crawler?.daily_token_budget} />
      </Card>
      <Card title="Search">
        <SearchSettings settings={settings} onChange={update} />
      </Card>
      <Card title="Job portals">
        <PortalSettings />
      </Card>
      <Card title="Target companies">
        <CareerPages profile={profile} />
      </Card>
      <Card title="Google Drive">
        <DriveSettings settings={settings} onChange={update} notice={driveNotice} />
      </Card>
      <Card title="Account">
        <AccountSettings />
      </Card>
    </div>
  );
}
