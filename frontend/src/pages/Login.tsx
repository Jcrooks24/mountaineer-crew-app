import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { useLogoSrc } from "../theme/ThemeContext";

type TokenResponse = { access_token: string; token_type: string };

export default function Login() {
  const nav = useNavigate();
  const { loginWithToken } = useAuth();
  const logo = useLogoSrc();
  const [searchParams] = useSearchParams();
  const didReset = searchParams.get("reset") === "1";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);

    try {
      const res = await apiFetch<TokenResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });

      await loginWithToken(res.access_token);
      nav("/", { replace: true });
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: 480 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginTop: 48, marginBottom: 8, gap: 10 }}>
        <img
          src={logo}
          alt="Logo"
          style={{ width: 48, height: 48, borderRadius: 14, objectFit: "contain", filter: "invert(1) brightness(1.15) contrast(1.05)" }}
        />
        <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: 0.2 }}>Mountaineer Moving Co.</div>
      </div>

      <div className="card">
        <div className="sectionTitle" style={{ fontSize: 18, marginBottom: 18 }}>Log in</div>

        {didReset && (
          <div className="small" style={{ color: "var(--ok)", marginBottom: 14 }}>
            Password updated — log in with your new password.
          </div>
        )}

        <form onSubmit={onSubmit} className="col" style={{ gap: 14 }}>
          <div className="col">
            <div className="label">Email</div>
            <input
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              type="email"
              autoComplete="email"
              required
            />
          </div>

          <div className="col">
            <div className="label">Password</div>
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
          </div>

          {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}

          <button className="btnPrimary" disabled={busy} style={{ width: "100%", marginTop: 4 }}>
            {busy ? "Logging in…" : "Log in"}
          </button>
        </form>

        <div style={{ marginTop: 18, display: "flex", flexDirection: "column", gap: 8 }}>
          <div className="small">
            No account?{" "}
            <Link to="/signup" style={{ color: "var(--brand)", textDecoration: "none", fontWeight: 600 }}>
              Sign up
            </Link>
          </div>
          <Link to="/forgot-password" style={{ color: "var(--muted)", textDecoration: "none", fontSize: 12 }}>
            Forgot password?
          </Link>
        </div>
      </div>
    </div>
  );
}
