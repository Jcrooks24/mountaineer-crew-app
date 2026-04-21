import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../api/client";
import { clearToken, getToken, setToken } from "./token";

export type User = {
  id: number;
  email: string;
  name?: string | null;
  role?: string;
  is_active?: boolean;
  profile_photo?: string | null;
};

export type DirectoryEntry = {
  id: number;
  email: string;
  name?: string | null;
  profile_photo?: string | null;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  loginWithToken: (token: string) => Promise<void>;
  logout: () => void;
  setUser: (user: User | null) => void;
};

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadMe() {
    try {
      const token = getToken();
      if (!token) {
        setUser(null);
        return;
      }
      const me = await apiFetch<User>("/api/auth/me");
      setUser(me);
    } catch (err) {
      // Only clear user on a genuine auth rejection (401/403).
      // Network/connectivity errors (TypeError) leave the token intact so the
      // user isn't silently logged out when the server is briefly unreachable.
      if (err instanceof ApiError) {
        setUser(null);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loginWithToken(token: string) {
    setToken(token);
    setLoading(true);
    await loadMe();
  }

  function logout() {
    clearToken();
    sessionStorage.removeItem("crew_session_jobDate");
    sessionStorage.removeItem("crew_session_calId");
    sessionStorage.removeItem("crew_session_manualEntries");
    setUser(null);
  }

  const value = useMemo(
    () => ({ user, loading, loginWithToken, logout, setUser }),
    [user, loading],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
