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

export async function createPhotoPost(file: File, text: string): Promise<BulletinPost> {
  const form = new FormData();
  form.append("file", file);
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
