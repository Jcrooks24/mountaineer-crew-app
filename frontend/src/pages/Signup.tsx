import React, { useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { useResolvedLogo } from "../theme/ThemeContext";

type PendingResponse = { pending: boolean; message: string };

export default function Signup() {
  const { src: logo, variant: logoVariant } = useResolvedLogo();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pendingMsg, setPendingMsg] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);

    try {
      const res = await apiFetch<PendingResponse>("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ name: name || null, email, password }),
      });
      setPendingMsg(res.message);
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
          style={{
            width: 48, height: 48, borderRadius: 14, objectFit: "contain",
            filter: logoVariant === "light" ? "invert(1) brightness(1.15) contrast(1.05)" : undefined,
          }}
        />
        <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: 0.2 }}>Mountaineer Moving Co.</div>
      </div>

      <div className="card">
        {pendingMsg ? (
          <div className="col" style={{ gap: 16, textAlign: "center", padding: "8px 0" }}>
            <div style={{ fontSize: 32 }}>✓</div>
            <div style={{ fontWeight: 700, fontSize: 16 }}>Account requested</div>
            <div className="small" style={{ color: "var(--muted)", lineHeight: 1.5 }}>{pendingMsg}</div>
            <Link to="/login" style={{ color: "var(--brand)", textDecoration: "none", fontWeight: 600, fontSize: 14 }}>
              ← Back to login
            </Link>
          </div>
        ) : (
          <>
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
          </>
        )}
      </div>
    </div>
  );
}
