import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

// Last successful /me response, kept in localStorage so the app can boot
// against the cached profile when the network is unreachable. Cleared on
// logout and on a genuine auth rejection (401/403) — never on transient
// network errors.
const USER_CACHE_KEY = "mm_user_cache_v1";

function loadCachedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "number") {
      return null;
    }
    return parsed as User;
  } catch {
    return null;
  }
}

function saveCachedUser(user: User): void {
  try {
    localStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
  } catch {}
}

function clearCachedUser(): void {
  try {
    localStorage.removeItem(USER_CACHE_KEY);
  } catch {}
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Seed from the cached profile if a token exists. Lets a crew member open
  // the app at a no-signal jobsite and land in the authenticated UI instead
  // of being bounced to /login (which requires the network to be useful).
  const [user, setUserState] = useState<User | null>(() => {
    if (!getToken()) return null;
    return loadCachedUser();
  });
  // Skip the "Loading…" flash on startup when we already have a token + a
  // cached profile: the user is effectively logged in. loadMe still fires
  // in the background to revalidate against the server.
  const [loading, setLoading] = useState<boolean>(() => {
    if (!getToken()) return true;
    return loadCachedUser() === null;
  });

  // setUser is the externally-exposed setter — keep the cache in sync so a
  // profile update (name change, photo upload) survives the next offline boot.
  const setUser = useCallback((next: User | null) => {
    setUserState(next);
    if (next) saveCachedUser(next);
    else clearCachedUser();
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const token = getToken();
      if (!token) {
        setUser(null);
        return;
      }
      const me = await apiFetch<User>("/api/auth/me");
      setUser(me);
    } catch (err) {
      // Only clear on a genuine auth rejection. Network errors (TypeError,
      // "Failed to fetch") preserve whatever's already in state, including
      // the seed-from-cache user from constructor — so an offline launch
      // doesn't kick the crew member to /login.
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        setUser(null);
        clearToken();
      }
    } finally {
      setLoading(false);
    }
  }, [setUser]);

  useEffect(() => {
    loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When connectivity returns, re-validate the token against the server so a
  // revoked / deactivated user does eventually get logged out — just not
  // while they're offline in the field.
  useEffect(() => {
    function onOnline() { loadMe(); }
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [loadMe]);

  async function loginWithToken(token: string) {
    setToken(token);
    setLoading(true);
    await loadMe();
  }

  function logout() {
    clearToken();
    clearCachedUser();
    sessionStorage.removeItem("crew_session_jobDate");
    sessionStorage.removeItem("crew_session_calId");
    sessionStorage.removeItem("crew_session_manualEntries");
    setUserState(null);
  }

  const value = useMemo(
    () => ({ user, loading, loginWithToken, logout, setUser }),
    [user, loading, setUser],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
