import { useCallback, useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../auth";
import { Alert, Card, timeAgo } from "../components/ui";

export function AdminPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const [s, u] = await Promise.all([api.adminStats(), api.adminUsers(q)]);
      setStats(s);
      setUsers(u.users);
    } catch (err) {
      setError(err.message);
    }
  }, [q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  if (user?.role !== "admin") return <Navigate to="/jobs" replace />;

  async function act(fn) {
    setError("");
    setNotice("");
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  const failed24h = stats?.runs_24h?.filter((r) => r.status === "failed").reduce((n, r) => n + r.count, 0) || 0;
  const total24h = stats?.runs_24h?.reduce((n, r) => n + r.count, 0) || 0;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Admin</h1>
      </header>
      {stats ? (
        <div className="stat-grid">
          <div className="stat"><span>{stats.users}</span>users</div>
          <div className="stat"><span>{stats.active_users_7d}</span>active in 7 days</div>
          <div className="stat"><span>{stats.jobs}</span>jobs stored</div>
          <div className="stat"><span>{total24h}</span>runs in 24h ({failed24h} failed)</div>
        </div>
      ) : null}
      <Alert tone="error">{error}</Alert>
      <Alert tone="success">{notice}</Alert>
      <Card title="Users" actions={<input type="search" placeholder="Search email or name" aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} />}>
        <ul className="list">
          {users.map((u) => (
            <li key={u.id} className="list-row wrap">
              <div className="grow min0">
                <p className="strong truncate">
                  {u.name || u.email} {u.role === "admin" ? <span className="badge badge-blue">admin</span> : null}
                  {u.status === "disabled" ? <span className="badge badge-red">disabled</span> : null}
                </p>
                <p className="muted small truncate">
                  {u.email} · {u.jobs} jobs · AI {u.ai_provider || "none"} · {u.hourly ? "hourly on" : "hourly off"} · last login {timeAgo(u.last_login_at) || "never"}
                </p>
              </div>
              {u.id !== user.id ? (
                <div className="row gap">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() =>
                      act(async () => {
                        if (!window.confirm(`Reset the password for ${u.email}?`)) return;
                        const { temporary_password } = await api.adminResetPassword(u.id);
                        setNotice(`Temporary password for ${u.email}: ${temporary_password} (shown once; they must change it at next sign-in)`);
                      })
                    }
                  >
                    Reset password
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => act(() => api.adminUpdateUser(u.id, { status: u.status === "active" ? "disabled" : "active" }))}
                  >
                    {u.status === "active" ? "Disable" : "Enable"}
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
