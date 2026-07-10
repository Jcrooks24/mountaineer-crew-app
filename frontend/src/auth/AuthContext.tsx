import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { apiFetch, ApiError } from "../api/client";
import { clearToken, getToken, setToken } from "./token";
import { clearCrewState } from "./clearCrewState";

export type User = {
  id: number;
  email: string;
  name?: string | null;
  role?: string;
  is_active?: boolean;
  // Admin-set flag gating who can view/fill skill ratings on the Job Report
  // (distinct from the crew_lead role, which also grants report submit powers).
  is_crew_lead?: boolean;
  profile_photo?: string | null;
  scheduling_notes?: string;
};

export type DirectoryEntry = {
  id: number;
  email: string;
  name?: string | null;
  profile_photo?: string | null;
};

// Staging-only "preview as role" dev tool. Lets an admin view the app as a
// lower role (crew / crew lead / skill rater) to test role-gated UI without
// logging out. Gated on VITE_STAGING so it never renders on production (main).
// Client-side view override only - the server still sees the real admin token.
export type PreviewRole = "crew_lead" | "skill_rater" | "crew";
const STAGING = import.meta.env.VITE_STAGING === "true";
const PREVIEW_KEY = "mm_preview_role_v1";
const PREVIEW_OVERRIDES: Record<PreviewRole, { role: string; is_crew_lead: boolean }> = {
  crew_lead: { role: "crew_lead", is_crew_lead: false },
  skill_rater: { role: "user", is_crew_lead: true },
  crew: { role: "user", is_crew_lead: false },
};

type AuthState = {
  user: User | null;
  loading: boolean;
  loginWithToken: (token: string) => Promise<void>;
  logout: () => void;
  setUser: (user: User | null) => void;
  // Staging-only role preview (null = real role). canPreview is true only on
  // staging for a real admin.
  previewRole: PreviewRole | null;
  setPreviewRole: (r: PreviewRole | null) => void;
  canPreview: boolean;
};

const AuthCtx = createContext<AuthState | null>(null);

// Last successful /me response, kept in localStorage so the app can boot
// against the cached profile when the network is unreachable. Cleared on
// logout and on a genuine auth rejection (401/403) - never on transient
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

  // setUser is the externally-exposed setter - keep the cache in sync so a
  // profile update (name change, photo upload) survives the next offline boot.
  const setUser = useCallback((next: User | null) => {
    setUserState(next);
    if (next) saveCachedUser(next);
    else clearCachedUser();
  }, []);

  // Staging-only role preview. Persisted to sessionStorage so it survives
  // navigation but resets on a fresh session. Only meaningful for a real admin.
  const [previewRole, setPreviewRoleState] = useState<PreviewRole | null>(() => {
    if (!STAGING) return null;
    try {
      const v = sessionStorage.getItem(PREVIEW_KEY);
      return v === "crew_lead" || v === "skill_rater" || v === "crew" ? v : null;
    } catch {
      return null;
    }
  });
  const setPreviewRole = useCallback((r: PreviewRole | null) => {
    setPreviewRoleState(r);
    try {
      if (r) sessionStorage.setItem(PREVIEW_KEY, r);
      else sessionStorage.removeItem(PREVIEW_KEY);
    } catch {}
  }, []);

  const loadMe = useCallback(async () => {
    try {
      const token = getToken();
      if (!token) {
        setUser(null);
        return;
      }
      const me = await apiFetch<User>("/api/auth/me");
      // If the user that the server identifies us as differs from whatever
      // was cached on this device, wipe leftover per-user storage before
      // we adopt the new identity. Covers the shared-phone case where
      // crew A logs out and crew B logs in: crew A's queued materials,
      // availability draft, and banner-dismiss flag would otherwise carry
      // over and be submitted under crew B's identity.
      const previous = loadCachedUser();
      if (previous && previous.id !== me.id) {
        clearCrewState();
      }
      setUser(me);
    } catch (err) {
      // Only clear on a genuine auth rejection. Network errors (TypeError,
      // "Failed to fetch") preserve whatever's already in state, including
      // the seed-from-cache user from constructor - so an offline launch
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
  // revoked / deactivated user does eventually get logged out - just not
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
    // Wipe per-user storage so the next crew member to log in on this
    // device starts clean: no leftover queues, drafts, or dismiss flags.
    clearCrewState();
    setPreviewRole(null);
    setUserState(null);
  }

  // canPreview is based on the REAL role (not the previewed one) so an admin
  // previewing as crew can still switch back.
  const canPreview = STAGING && user?.role === "admin";

  // The role/is_crew_lead the rest of the app sees. When previewing, overlay
  // the chosen role onto the real user (id/name/email stay real). The cached
  // profile is never overwritten with a previewed role - only server responses
  // are saved via setUser.
  const effectiveUser = useMemo<User | null>(() => {
    if (!user) return null;
    if (!canPreview || !previewRole) return user;
    const o = PREVIEW_OVERRIDES[previewRole];
    return { ...user, role: o.role, is_crew_lead: o.is_crew_lead };
  }, [user, canPreview, previewRole]);

  const value = useMemo(
    () => ({
      user: effectiveUser,
      loading,
      loginWithToken,
      logout,
      setUser,
      previewRole,
      setPreviewRole,
      canPreview,
    }),
    [effectiveUser, loading, setUser, previewRole, setPreviewRole, canPreview],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
