import { NavLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth";

const ICONS = {
  jobs: "M4 7h16v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7zm5 0V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2",
  resume: "M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zm7 0v5h5M9 13h6M9 17h6",
  activity: "M3 12h4l3-8 4 16 3-8h4",
  settings: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.6 7.6 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.6 7.6 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  admin: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z",
};

function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

export function Shell() {
  const { user, logout } = useAuth();
  const items = [
    { to: "/jobs", label: "Jobs", icon: "jobs" },
    { to: "/resume", label: "Resume", icon: "resume" },
    { to: "/activity", label: "Activity", icon: "activity" },
    { to: "/settings", label: "Settings", icon: "settings" },
  ];
  if (user?.role === "admin") items.push({ to: "/admin", label: "Admin", icon: "admin" });

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <img src="/favicon.svg" alt="" width="28" height="28" />
          <span>Job Crawler</span>
        </div>
        <nav aria-label="Main">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} className="side-link">
              <Icon name={item.icon} />
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-foot">
          <p className="sidebar-user">{user?.email}</p>
          <button type="button" className="link-btn" onClick={logout}>
            Sign out
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Main">
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} className="bottom-link">
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
