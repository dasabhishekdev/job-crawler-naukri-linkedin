import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth";
import { Shell } from "./components/Shell";
import { AuthPage } from "./pages/AuthPage";
import { Onboarding } from "./pages/Onboarding";
import { JobsPage } from "./pages/Jobs";
import { ResumePage } from "./pages/Resume";
import { ActivityPage } from "./pages/Activity";
import { SettingsPage } from "./pages/Settings";
import { NeedsHelpPage } from "./pages/NeedsHelp";
import { AdminPage } from "./pages/Admin";
import { ForcePasswordChange } from "./pages/ForcePasswordChange";

function Splash() {
  return (
    <div className="splash" aria-busy="true">
      <span className="spinner spinner-lg" />
    </div>
  );
}

function RequireAuth({ children }) {
  const { loading, user, onboarding } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (user.must_change_password) return <ForcePasswordChange />;
  if (!onboarding?.complete && location.pathname !== "/onboarding") return <Navigate to="/onboarding" replace />;
  return children;
}

function PublicOnly({ children }) {
  const { loading, user } = useAuth();
  if (loading) return <Splash />;
  if (user) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><AuthPage mode="login" /></PublicOnly>} />
      <Route path="/signup" element={<PublicOnly><AuthPage mode="signup" /></PublicOnly>} />
      <Route path="/onboarding" element={<RequireAuth><Onboarding /></RequireAuth>} />
      <Route element={<RequireAuth><Shell /></RequireAuth>}>
        <Route path="/jobs" element={<JobsPage />} />
        <Route path="/resume" element={<ResumePage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/needs-help" element={<NeedsHelpPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/jobs" replace />} />
    </Routes>
  );
}
