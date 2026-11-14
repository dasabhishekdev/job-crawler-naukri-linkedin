import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api } from "./api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, user: null, onboarding: null });

  const refresh = useCallback(async () => {
    try {
      const data = await api.me();
      setState({ loading: false, user: data.user, onboarding: data.onboarding });
      return data;
    } catch {
      setState({ loading: false, user: null, onboarding: null });
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({
      ...state,
      refresh,
      setSession: (data) => setState({ loading: false, user: data.user, onboarding: data.onboarding }),
      async logout() {
        await api.logout().catch(() => {});
        setState({ loading: false, user: null, onboarding: null });
      },
    }),
    [state, refresh]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
