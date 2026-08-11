/**
 * Driver Qualification (DQ) file API (C4.1).
 *
 * Reads use apiFetch; uploads are multipart, so they use a raw fetch with the
 * bearer token (apiFetch forces a JSON content-type, which breaks FormData) -
 * the same pattern as the bug-report screenshot upload. Uploads need a
 * connection; DQ filing is an office/onboarding task, not offline field work.
 */
import { apiFetch } from "../api/client";
import { getToken } from "../auth/token";

const API = (import.meta as any).env?.VITE_API_URL || "http://127.0.0.1:8000";

export type DqDocType = { key: string; name: string; audience: "driver" | "admin"; required: boolean };

export type DqDoc = {
  doc_type: string;
  doc_name: string | null;
  drive_url: string | null;
  filename: string | null;
  submitted_by_name: string | null;
  submitted_at: string | null;
};

export type DqFileItem = {
  key: string;
  name: string;
  audience: "driver" | "admin";
  required: boolean;
  document: DqDoc | null;
  missing: boolean;
  // Submitted but due for renewal (e.g. the annual cert nearing its 1-year mark).
  renewal_due?: boolean;
  // ISO date the current submission lapses (for renewal docs).
  due_date?: string | null;
};

export type DqFile = {
  user_id: number;
  name?: string;
  types: DqFileItem[];
  missing_required: string[];
  /** False for staff with no Driver tag: they have no DQ obligation, so the
   *  card hides rather than reporting an empty file as complete. */
  is_driver?: boolean;
};

async function postFile(path: string, form: FormData): Promise<void> {
  const token = getToken() || "";
  const res = await fetch(`${API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.detail || `HTTP ${res.status}`);
}

// ── Driver ───────────────────────────────────────────────────────────────────

export async function loadMyDqFile(): Promise<DqFile> {
  return apiFetch<DqFile>("/api/dq/my");
}

export async function uploadMyDq(file: File, docType: string): Promise<void> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("doc_type", docType);
  await postFile("/api/dq/my/upload", form);
}

// ── Admin ────────────────────────────────────────────────────────────────────

export type DqOverview = {
  drivers: { user_id: number; name: string; missing_count: number; required_count: number }[];
  required_count: number;
};

export async function loadDqOverview(): Promise<DqOverview> {
  return apiFetch<DqOverview>("/api/admin/dq");
}

export async function loadDqFile(userId: number): Promise<DqFile> {
  return apiFetch<DqFile>(`/api/admin/dq/${userId}`);
}

export async function adminUploadDq(file: File, userId: number, docType: string): Promise<void> {
  const form = new FormData();
  form.append("file", file, file.name);
  form.append("user_id", String(userId));
  form.append("doc_type", docType);
  await postFile("/api/admin/dq/upload", form);
}
