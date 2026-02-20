import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

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
    <div style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1>Sign up</h1>

      <form onSubmit={onSubmit}>
        <label>Name (optional)</label>
        <input
          style={{ width: "100%", padding: 10, margin: "8px 0" }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
        />

        <label>Email</label>
        <input
          style={{ width: "100%", padding: 10, margin: "8px 0" }}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
        />

        <label>Password</label>
        <input
          style={{ width: "100%", padding: 10, margin: "8px 0" }}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          type="password"
          autoComplete="new-password"
        />

        {err && <div style={{ color: "crimson", marginTop: 8 }}>{err}</div>}

        <button disabled={busy} style={{ width: "100%", padding: 12, marginTop: 12 }}>
          {busy ? "Creating..." : "Create account"}
        </button>
      </form>

      <div style={{ marginTop: 12 }}>
        Already have an account? <Link to="/login">Login</Link>
      </div>
    </div>
  );
}