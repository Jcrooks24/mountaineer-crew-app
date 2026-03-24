import React, { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import logo from "../assets/logo.png";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const nav = useNavigate();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    if (password !== confirm) {
      setErr("Passwords do not match");
      return;
    }

    setBusy(true);

    try {
      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, new_password: password }),
      });
      nav("/login?reset=1", { replace: true });
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
          style={{ width: 48, height: 48, borderRadius: 14, objectFit: "contain", filter: "invert(1) brightness(1.15) contrast(1.05)" }}
        />
        <div style={{ fontWeight: 900, fontSize: 18, letterSpacing: 0.2 }}>Mountaineer Moving Co.</div>
      </div>

      <div className="card">
        {!token ? (
          <div className="col" style={{ gap: 14 }}>
            <div className="small" style={{ color: "var(--danger)" }}>Invalid or missing reset link.</div>
            <Link to="/login" style={{ color: "var(--brand)", textDecoration: "none", fontSize: 13, fontWeight: 600 }}>
              &larr; Back to login
            </Link>
          </div>
        ) : (
          <>
            <div className="sectionTitle" style={{ fontSize: 18, marginBottom: 18 }}>Set new password</div>

            <form onSubmit={onSubmit} className="col" style={{ gap: 14 }}>
              <div className="col">
                <div className="label">New password</div>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>

              <div className="col">
                <div className="label">Confirm password</div>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  required
                />
              </div>

              {err && <div className="small" style={{ color: "var(--danger)" }}>{err}</div>}

              <button className="btnPrimary" disabled={busy} style={{ width: "100%", marginTop: 4 }}>
                {busy ? "Saving…" : "Set new password"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
