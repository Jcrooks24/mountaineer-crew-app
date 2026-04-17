import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { apiFetch, ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { getToken } from "../auth/token";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

type DocumentRow = {
  id: number;
  title: string;
  category: string;
  filename: string;
  mime_type: string;
  drive_file_id: string;
  drive_url: string;
  uploaded_by_id: number | null;
  uploaded_by_name: string | null;
  created_at: string;
};

const CATEGORY_SUGGESTIONS = ["COI", "Contract", "BOL", "Estimate", "Policies", "General"];

export default function DocumentLibrary() {
  const { user } = useAuth();
  const nav = useNavigate();
  const isAdmin = user?.role === "admin";

  const [docs, setDocs] = useState<DocumentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("General");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function refresh() {
    setLoading(true);
    setErr(null);
    try {
      const rows = await apiFetch<DocumentRow[]>("/api/documents");
      setDocs(rows);
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Could not load documents");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!title.trim()) return setErr("Title is required.");
    if (!file) return setErr("Choose a file to upload.");

    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("title", title.trim());
      form.append("category", category.trim() || "General");

      const token = getToken() || "";
      const res = await fetch(`${API}/api/documents/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }
      setTitle("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleDelete(d: DocumentRow) {
    if (!confirm(`Delete "${d.title}"? This cannot be undone.`)) return;
    try {
      await apiFetch(`/api/documents/${d.id}`, { method: "DELETE" });
      setDocs((prev) => prev.filter((x) => x.id !== d.id));
    } catch (e: any) {
      setErr(e instanceof ApiError ? e.message : "Delete failed");
    }
  }

  const grouped = useMemo(() => {
    const map = new Map<string, DocumentRow[]>();
    for (const d of docs) {
      const key = (d.category || "General").trim() || "General";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(d);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [docs]);

  return (
    <div className="container">
      <div className="topbar" style={{ marginBottom: 16 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16 }}>Document Library</div>
          <div className="small" style={{ color: "var(--muted)" }}>Reference documents for the crew</div>
        </div>
        <button
          onClick={() => nav(-1)}
          style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 13 }}
        >
          ← Back
        </button>
      </div>

      {isAdmin && (
        <div className="card">
          <div className="sectionTitle">Upload Document (admin)</div>
          <form onSubmit={handleUpload} className="col" style={{ gap: 10 }}>
            <div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Title *</div>
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Liability Insurance COI 2026" />
            </div>

            <div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>Category</div>
              <div className="row wrap" style={{ gap: 6, marginBottom: 6 }}>
                {CATEGORY_SUGGESTIONS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setCategory(c)}
                    style={{
                      fontSize: 12,
                      padding: "4px 10px",
                      borderRadius: 999,
                      border: `1px solid ${category === c ? "var(--brand)" : "var(--border)"}`,
                      color: category === c ? "var(--brand)" : "var(--muted)",
                      background: category === c ? "rgba(93,214,194,0.1)" : "transparent",
                    }}
                  >
                    {c}
                  </button>
                ))}
              </div>
              <input value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Category" />
            </div>

            <div>
              <div className="small" style={{ color: "var(--muted)", marginBottom: 4 }}>File *</div>
              <input
                ref={fileRef}
                type="file"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <button type="submit" className="btnPrimary" disabled={uploading}>
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </form>
        </div>
      )}

      {err && (
        <div className="card" style={{ color: "var(--danger)", fontSize: 13 }}>{err}</div>
      )}

      {loading && <div className="card small" style={{ color: "var(--muted)" }}>Loading…</div>}

      {!loading && docs.length === 0 && (
        <div className="card" style={{ color: "var(--muted)", fontSize: 13, textAlign: "center", padding: 24 }}>
          No documents yet. {isAdmin ? "Upload the first one above." : "Ask an admin to upload reference documents."}
        </div>
      )}

      {grouped.map(([category, list]) => (
        <div key={category} className="card">
          <div className="sectionTitle">{category}</div>
          <div className="col" style={{ gap: 8 }}>
            {list.map((d) => (
              <div
                key={d.id}
                className="row"
                style={{
                  justifyContent: "space-between",
                  gap: 10,
                  padding: "10px 0",
                  borderTop: "1px solid var(--border)",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {d.title}
                  </div>
                  <div className="small" style={{ color: "var(--muted)" }}>
                    {d.filename} · {new Date(d.created_at).toLocaleDateString()}
                    {d.uploaded_by_name ? ` · ${d.uploaded_by_name}` : ""}
                  </div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <a
                    href={d.drive_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      fontSize: 12,
                      padding: "6px 12px",
                      borderRadius: 8,
                      border: "1px solid var(--brand)",
                      color: "var(--brand)",
                      textDecoration: "none",
                    }}
                  >
                    View
                  </a>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => handleDelete(d)}
                      style={{ fontSize: 12, padding: "6px 12px", color: "var(--danger)", borderColor: "var(--danger)" }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
