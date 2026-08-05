/**
 * Company Bulletin API client. A community feed, so it is intentionally lighter
 * than the offline-first core tools: posts go straight to the server with clear
 * errors (no localStorage queue), and the feed is fetch-on-mount + refresh. Each
 * post/comment carries a client-minted UUID so a double-tap can't duplicate.
 */
import { apiFetch } from "../api/client";
import { getToken } from "../auth/token";

const API = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

export type BulletinComment = {
  comment_uuid: string;
  author_id: number | null;
  author_name: string;
  text: string;
  created_at: string;
};

export type BulletinPost = {
  post_uuid: string;
  author_id: number | null;
  author_name: string;
  kind: "photo" | "link" | "text";
  text: string;
  image_url: string | null;
  image_thumb_url: string | null;
  link_url: string | null;
  link_title: string | null;
  link_description: string | null;
  link_image_url: string | null;
  created_at: string;
  like_count: number;
  liked_by_me: boolean;
  comments: BulletinComment[];
};

export type Feed = { posts: BulletinPost[]; next_before_id: number | null };

function uuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function fetchFeed(beforeId?: number | null): Promise<Feed> {
  const q = beforeId ? `?before_id=${beforeId}` : "";
  return apiFetch<Feed>(`/api/bulletin/feed${q}`);
}

export function createTextPost(text: string): Promise<BulletinPost> {
  return apiFetch<BulletinPost>("/api/bulletin/posts", {
    method: "POST",
    body: JSON.stringify({ post_uuid: uuid(), kind: "text", text }),
  });
}

export function createLinkPost(linkUrl: string, text: string): Promise<BulletinPost> {
  return apiFetch<BulletinPost>("/api/bulletin/posts", {
    method: "POST",
    body: JSON.stringify({ post_uuid: uuid(), kind: "link", link_url: linkUrl, text }),
  });
}

// Resize a photo to a sane max dimension + JPEG before upload, so the bytes we
// store server-side (and load into the worker to serve) stay small. Falls back
// to the original file if the canvas path fails.
async function resizeImage(file: File, maxPx = 1600, quality = 0.85): Promise<Blob> {
  try {
    const bmpUrl = URL.createObjectURL(file);
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = bmpUrl;
    });
    const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no canvas");
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(bmpUrl);
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", quality));
    return blob || file;
  } catch {
    return file;
  }
}

export async function createPhotoPost(file: File, text: string): Promise<BulletinPost> {
  const blob = await resizeImage(file);
  const form = new FormData();
  form.append("file", new File([blob], "photo.jpg", { type: "image/jpeg" }));
  form.append("post_uuid", uuid());
  form.append("text", text);
  const res = await fetch(`${API}/api/bulletin/posts/photo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken() || ""}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.detail || `Upload failed (HTTP ${res.status})`);
  return json as BulletinPost;
}

// image_url is relative for server-stored images ("/api/bulletin/image/...") and
// absolute for legacy Drive posts; resolve both to a usable <img src>.
export function postImageSrc(post: BulletinPost): string | null {
  const u = post.image_url;
  if (!u) return null;
  return u.startsWith("http") ? u : `${API}${u}`;
}

// ── "New activity" dot for the nav ──
const SEEN_KEY = "crew_bulletin_seen_id_v1";
export function getSeenId(): number {
  try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; }
}
export function setSeenId(id: number): void {
  try { localStorage.setItem(SEEN_KEY, String(id)); } catch { /* noop */ }
}
export function fetchLatestId(): Promise<{ latest_id: number }> {
  return apiFetch<{ latest_id: number }>("/api/bulletin/latest");
}

export function toggleLike(postUuid: string): Promise<{ liked: boolean; like_count: number }> {
  return apiFetch(`/api/bulletin/posts/${encodeURIComponent(postUuid)}/like`, { method: "POST" });
}

export function addComment(postUuid: string, text: string): Promise<BulletinComment> {
  return apiFetch<BulletinComment>(`/api/bulletin/posts/${encodeURIComponent(postUuid)}/comments`, {
    method: "POST",
    body: JSON.stringify({ comment_uuid: uuid(), text }),
  });
}

export function removePost(postUuid: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/bulletin/posts/${encodeURIComponent(postUuid)}`, { method: "DELETE" });
}

export function removeComment(commentUuid: string): Promise<{ ok: boolean }> {
  return apiFetch(`/api/bulletin/comments/${encodeURIComponent(commentUuid)}`, { method: "DELETE" });
}

// "3m", "2h", "4d", or a date for older.
export function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const secs = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });
}
