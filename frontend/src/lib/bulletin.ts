/**
 * Company Bulletin API client. A community feed, so it is intentionally lighter
 * than the offline-first core tools: posts go straight to the server with clear
 * errors (no localStorage queue), and the feed is fetch-on-mount + refresh. Each
 * post/comment carries a client-minted UUID so a double-tap can't duplicate.
 */
import { apiFetch } from "../api/client";
import { getToken } from "../auth/token";
import { coalesce } from "./sharedFetch";

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
  /** Which reaction this post accepts. The server decides; the client renders.
   *  Optional so a client running against an older backend still works - it
   *  falls back to "like", which is what every post was before this existed. */
  reaction_mode?: ReactionMode;
  /** Whether THIS viewer may switch the mode. Computed server-side; the client
   *  never holds the rule about who is allowed. Hiding the control is a
   *  courtesy - the endpoint refuses anyone else regardless. */
  can_set_reaction_mode?: boolean;
};

export type ReactionMode = "like" | "dislike";

export type Feed = { posts: BulletinPost[]; next_before_id: number | null };

function uuid(): string {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Coerce one post into a shape the UI can render.
 *
 * `apiFetch<BulletinPost>` is a TYPE assertion, not a runtime check - the
 * generic is erased, so a degraded server response flows straight into JSX. A
 * post arriving without `comments` blows up on `post.comments.length` during
 * render, which unmounts the tree behind the app-wide ErrorBoundary. Guaranteeing
 * the array here is cheaper than guarding every read of it.
 */
function normalizePost(raw: any): BulletinPost {
  return {
    ...(raw as BulletinPost),
    comments: Array.isArray(raw?.comments) ? raw.comments : [],
  };
}

export async function fetchFeed(beforeId?: number | null): Promise<Feed> {
  const q = beforeId ? `?before_id=${beforeId}` : "";
  const raw = await apiFetch<any>(`/api/bulletin/feed${q}`);
  // A malformed body must be an ERROR, not an empty feed. Without this, a
  // degraded response (a 200 carrying an error object, a proxy page, a partial
  // payload) renders as "Nothing posted yet" - which tells a crew member the
  // bulletin is empty when it is actually broken, and gives them no Retry.
  if (!raw || !Array.isArray(raw.posts)) {
    throw new Error("The bulletin sent back something this app could not read.");
  }
  return {
    posts: raw.posts
      .filter((p: any) => p && typeof p === "object")
      .map(normalizePost),
    next_before_id:
      typeof raw.next_before_id === "number" ? raw.next_before_id : null,
  };
}

export function createTextPost(text: string): Promise<BulletinPost> {
  return apiFetch<any>("/api/bulletin/posts", {
    method: "POST",
    body: JSON.stringify({ post_uuid: uuid(), kind: "text", text }),
  }).then(normalizePost);
}

export function createLinkPost(linkUrl: string, text: string): Promise<BulletinPost> {
  return apiFetch<any>("/api/bulletin/posts", {
    method: "POST",
    body: JSON.stringify({ post_uuid: uuid(), kind: "link", link_url: linkUrl, text }),
  }).then(normalizePost);
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
  // GIFs (usually animated) must NOT go through the canvas resize - that flattens
  // them to a single JPEG frame and kills the animation. Send the original bytes;
  // everything else is resized/compressed to keep the stored image small.
  const upload =
    file.type === "image/gif"
      ? file
      : new File([await resizeImage(file)], "photo.jpg", { type: "image/jpeg" });
  const form = new FormData();
  form.append("file", upload);
  form.append("post_uuid", uuid());
  form.append("text", text);
  const res = await fetch(`${API}/api/bulletin/posts/photo`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getToken() || ""}` },
    body: form,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.detail || `Upload failed (HTTP ${res.status})`);
  // Same guarantee as the feed: a post reaching component state without a
  // `comments` array crashes the render that reads `post.comments.length`.
  return normalizePost(json);
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
  // Called by the bottom nav on EVERY navigation to decide whether to show a
  // dot, which made this 11% of all backend traffic in a production sample. A
  // dot saying "somebody posted" does not need per-tap freshness, and every
  // request spent here brings the 1000-request worker recycle closer.
  return coalesce(
    "bulletin:latest",
    () => apiFetch<{ latest_id: number }>("/api/bulletin/latest"),
    { ttlMs: 60_000 },
  );
}

export function toggleLike(postUuid: string): Promise<{ liked: boolean; like_count: number }> {
  return apiFetch(`/api/bulletin/posts/${encodeURIComponent(postUuid)}/like`, { method: "POST" });
}

/**
 * Switch one post between accepting likes and accepting dislikes.
 *
 * Returns 404 (not 403) for anyone who is not permitted, so a caller that has no
 * business knowing this endpoint exists learns nothing from it.
 */
export function setReactionMode(
  postUuid: string,
  mode: ReactionMode,
): Promise<{ post_uuid: string; reaction_mode: ReactionMode; like_count: number }> {
  return apiFetch(`/api/bulletin/posts/${encodeURIComponent(postUuid)}/reaction-mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
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
