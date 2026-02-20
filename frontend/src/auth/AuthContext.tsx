import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/client";
import { clearToken, getToken, setToken } from "./token";

export type User = {
  id: number;
  email: string;
  name?: string | null;
  role?: string;
  is_active?: boolean;
};

type AuthState = {
  user: User | null;
  loading: boolean;
  loginWithToken: (token: string) => Promise<void>;
  logout: () => void;
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
    } catch {
      setUser(null);
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
    setUser(null);
  }

  const value = useMemo(() => ({ user, loading, loginWithToken, logout }), [user, loading]);

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
