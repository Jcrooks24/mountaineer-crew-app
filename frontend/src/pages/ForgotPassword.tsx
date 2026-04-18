import React, { useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { useResolvedLogo } from "../theme/ThemeContext";

export default function ForgotPassword() {
  const { src: logo, variant: logoVariant } = useResolvedLogo();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);

    try {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Something went wrong");
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
        {sent ? (
          <div className="col" style={{ gap: 14 }}>
            <div className="sectionTitle" style={{ fontSize: 18 }}>Check your email</div>
            <div className="small" style={{ color: "var(--ok)" }}>
              If that address is registered, you'll receive a reset link shortly.
            </div>
            <Link to="/login" style={{ color: "var(--brand)", textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
              &larr; Back to login
            </Link>
          </div>
        ) : (
          <>
            <div className="sectionTitle" style={{ fontSize: 18, marginBottom: 6 }}>Forgot password</div>
            <div className="small" style={{ marginBottom: 18 }}>
              Enter your email and we'll send you a reset link.
            </div>

            <form onSubmit={onSubmit} className="col" style={{ gap: 14 }}>
              <div className="col">
                <div className="label">Email</div>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  required
                />
              </div>

              {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}

              <button className="btnPrimary" disabled={busy} style={{ width: "100%", marginTop: 4 }}>
                {busy ? "Sending…" : "Send reset link"}
              </button>
            </form>

            <div className="small" style={{ marginTop: 18 }}>
              <Link to="/login" style={{ color: "var(--muted)", textDecoration: "none" }}>
                &larr; Back to login
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
