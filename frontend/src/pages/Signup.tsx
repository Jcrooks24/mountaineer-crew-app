import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import logo from "../assets/logo.png";

type TokenResponse = { access_token: string; token_type: string };

export default function Signup() {
  const nav = useNavigate();
  const { loginWithToken } = useAuth();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);

    try {
      const res = await apiFetch<TokenResponse>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ name: name || null, email, password }),
      });

      await loginWithToken(res.access_token);
      nav("/", { replace: true });
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Signup failed");
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
        <div className="sectionTitle" style={{ fontSize: 18, marginBottom: 18 }}>Create account</div>

        <form onSubmit={onSubmit} className="col" style={{ gap: 14 }}>
          <div className="col">
            <div className="label">Name <span style={{ opacity: 0.5 }}>(optional)</span></div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              placeholder="Your name"
            />
          </div>

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
              autoComplete="new-password"
              required
            />
          </div>

          {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}

          <button className="btnPrimary" disabled={busy} style={{ width: "100%", marginTop: 4 }}>
            {busy ? "Creating…" : "Create account"}
          </button>
        </form>

        <div className="small" style={{ marginTop: 18 }}>
          Already have an account?{" "}
          <Link to="/login" style={{ color: "var(--brand)", textDecoration: "none", fontWeight: 600 }}>
            Log in
          </Link>
        </div>
      </div>
    </div>
  );
}
