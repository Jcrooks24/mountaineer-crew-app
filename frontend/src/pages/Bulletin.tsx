/**
 * Company Bulletin - the community feed ("Instagram-lite"). Crew share photo,
 * link, and text posts; everyone can like and comment. It is the post-login
 * landing, with a prominent "Go to work" button to jump to the core app, because
 * the bulletin takes the back seat to the real crew tools. Admins can remove any
 * post or comment.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import { BetaTag } from "../components/BetaTag";
import { useAuth } from "../auth/AuthContext";
import {
  fetchFeed, createTextPost, createLinkPost, createPhotoPost,
  toggleLike, addComment, removePost, removeComment, timeAgo,
  postImageSrc, setSeenId, fetchLatestId,
  type BulletinPost, type BulletinComment,
} from "../lib/bulletin";

export default function Bulletin() {
  const nav = useNavigate();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  const [posts, setPosts] = useState<BulletinPost[]>([]);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const f = await fetchFeed();
      setPosts(f.posts);
      setNextBefore(f.next_before_id);
    } catch (e: any) {
      // `||`, not `??`. An error carrying an EMPTY message - a 500 with no body,
      // a proxy error page, an aborted request - left `err` as "", which is
      // falsy, so the error card never rendered AND the `!err` empty state did.
      // A failed load disguised itself as "Nothing posted yet", with no Retry
      // button and no indication anything had gone wrong.
      setErr(e?.message || "Could not load the bulletin.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Opening the bulletin clears the nav "new activity" dot: mark the newest post
  // as seen.
  useEffect(() => {
    fetchLatestId().then((r) => setSeenId(r.latest_id)).catch(() => {});
  }, []);

  const loadMore = async () => {
    if (!nextBefore) return;
    try {
      const f = await fetchFeed(nextBefore);
      setPosts((prev) => [...prev, ...f.posts]);
      setNextBefore(f.next_before_id);
    } catch { /* leave the button; they can retry */ }
  };

  const onPosted = (p: BulletinPost) => setPosts((prev) => [p, ...prev]);
  const onRemoved = (uuid: string) => setPosts((prev) => prev.filter((p) => p.post_uuid !== uuid));
  const onPostChange = (p: BulletinPost) =>
    setPosts((prev) => prev.map((x) => (x.post_uuid === p.post_uuid ? p : x)));

  return (
    <div className="container" style={{ paddingBottom: 88 }}>
      <AppHeader
        title="Company Bulletin"
        right={
          <button type="button" onClick={load} title="Refresh" style={{ fontSize: 13 }}>
            ↻
          </button>
        }
      />

      {/* Prominent "get to work" exit - the bulletin is community-first, but the
          real tools are one tap away. */}
      <button
        type="button"
        onClick={() => nav("/")}
        className="btnPrimary"
        style={{ width: "100%", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}
      >
        Go to work - jobs, DVIR, reports →
      </button>

      <div className="row" style={{ alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div className="microLabel" style={{ marginBottom: 0 }}>Crew feed</div>
        <BetaTag feature="bulletin" style={{ marginTop: 0 }} />
      </div>

      <Composer onPosted={onPosted} />

      {err && (
        <div className="card" style={{ color: "var(--danger)", fontSize: 13 }}>
          {err} <button type="button" onClick={load} style={{ marginLeft: 8, fontSize: 12 }}>Retry</button>
        </div>
      )}

      {loading && posts.length === 0 && (
        <div className="card" style={{ color: "var(--muted)", textAlign: "center" }}>Loading the bulletin…</div>
      )}

      {!loading && posts.length === 0 && !err && (
        <div className="card" style={{ color: "var(--muted)", textAlign: "center", padding: 28 }}>
          Nothing posted yet. Be the first - share a photo, a link, or a note.
        </div>
      )}

      <div className="col" style={{ gap: 14 }}>
        {posts.map((p) => (
          <PostCard
            key={p.post_uuid}
            post={p}
            isAdmin={isAdmin}
            onChange={onPostChange}
            onRemoved={onRemoved}
          />
        ))}
      </div>

      {nextBefore && (
        <button type="button" onClick={loadMore} style={{ width: "100%", marginTop: 14, fontSize: 13 }}>
          Load older posts
        </button>
      )}
    </div>
  );
}

// ── Composer ────────────────────────────────────────────────────────────────
function Composer({ onPosted }: { onPosted: (p: BulletinPost) => void }) {
  const [text, setText] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => { setText(""); setLinkUrl(""); setLinkOpen(false); setFile(null); };

  const canPost = !busy && (file != null || linkUrl.trim() || text.trim());

  async function submit() {
    setErr(null);
    setBusy(true);
    try {
      let created: BulletinPost;
      if (file) created = await createPhotoPost(file, text.trim());
      else if (linkUrl.trim()) created = await createLinkPost(linkUrl.trim(), text.trim());
      else created = await createTextPost(text.trim());
      onPosted(created);
      reset();
    } catch (e: any) {
      // `||` not `??`, same reason as the feed loader above: an empty message
      // left the composer silently showing nothing after a failed post, so the
      // crew member believed it had gone through.
      setErr(e?.message || "Could not post. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Share something with the crew…"
        rows={2}
        style={{ width: "100%", resize: "vertical", fontSize: 16 }}
      />
      {file && (
        <div className="small" style={{ color: "var(--muted)", marginTop: 6, display: "flex", alignItems: "center", gap: 8 }}>
          📷 {file.name}
          <button type="button" onClick={() => setFile(null)} style={{ fontSize: 12, color: "var(--danger)" }}>remove</button>
        </div>
      )}
      {linkOpen && (
        <input
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          placeholder="Paste a website link (https://…)"
          inputMode="url"
          style={{ width: "100%", marginTop: 8, fontSize: 16 }}
        />
      )}
      {err && <div className="small" style={{ color: "var(--danger)", marginTop: 6 }}>{err}</div>}
      <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap", alignItems: "center" }}>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { setFile(f); setLinkOpen(false); } }}
          style={{ display: "none" }}
        />
        {/* Says "Photo" and not "Media" on purpose. The picker is image-only
            (accept="image/*"), and crews were trying to post video and reporting
            it as broken. Video is not built: bulletin images are stored in
            Postgres, so clips would need Drive-backed storage first. Until then
            the label and the hint below say what the button actually does,
            rather than letting the crew find out by failing. */}
        <button type="button" onClick={() => fileRef.current?.click()} style={{ fontSize: 13 }}>📷 Photo</button>
        <button type="button" onClick={() => { setLinkOpen((v) => !v); setFile(null); }} style={{ fontSize: 13 }}>🔗 Link</button>
        <button
          type="button"
          className="btnPrimary"
          onClick={submit}
          disabled={!canPost}
          style={{ marginLeft: "auto", fontSize: 13, opacity: canPost ? 1 : 0.5 }}
        >
          {busy ? "Posting…" : "Post"}
        </button>
      </div>
      <div className="small" style={{ color: "var(--muted)", marginTop: 6 }}>
        Photos and links only. Video is not supported yet.
      </div>
    </div>
  );
}

// ── Post card ───────────────────────────────────────────────────────────────
function PostCard({
  post, isAdmin, onChange, onRemoved,
}: {
  post: BulletinPost;
  isAdmin: boolean;
  onChange: (p: BulletinPost) => void;
  onRemoved: (uuid: string) => void;
}) {
  const [liking, setLiking] = useState(false);

  const like = async () => {
    if (liking) return;
    setLiking(true);
    // Optimistic
    const optimistic = {
      ...post,
      liked_by_me: !post.liked_by_me,
      like_count: post.like_count + (post.liked_by_me ? -1 : 1),
    };
    onChange(optimistic);
    try {
      const r = await toggleLike(post.post_uuid);
      onChange({ ...post, liked_by_me: r.liked, like_count: r.like_count });
    } catch {
      onChange(post); // revert
    } finally {
      setLiking(false);
    }
  };

  const remove = async () => {
    if (!confirm("Remove this post from the bulletin?")) return;
    try { await removePost(post.post_uuid); onRemoved(post.post_uuid); } catch { /* noop */ }
  };

  return (
    <div className="card" style={{ padding: 0, overflow: "hidden" }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, padding: "12px 14px 8px" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14 }}>{post.author_name || "Someone"}</div>
          <div className="small" style={{ color: "var(--muted)" }}>{timeAgo(post.created_at)}</div>
        </div>
        {isAdmin && (
          <button type="button" onClick={remove} title="Remove post" style={{ color: "var(--danger)", fontSize: 12, flexShrink: 0 }}>
            Remove
          </button>
        )}
      </div>

      {/* Media. Use the Drive THUMBNAIL url for the <img> - the plain Drive url
          is a webViewLink (opens Drive), which does not render in an image tag. */}
      {post.kind === "photo" && postImageSrc(post) && (
        <img
          src={postImageSrc(post)!}
          alt=""
          loading="lazy"
          // `contain`, not `cover`. With `cover` a portrait photo lost its top
          // and bottom to the 520px cap - crews reported "images are getting
          // cropped". The upload path never cropped: resizeImage scales by
          // min(1, max/longest side) onto a canvas of exactly that size, so the
          // aspect ratio is preserved. The crop was purely this style.
          //
          // `height: auto` lets a normal photo size itself naturally; the cap
          // only engages for something very tall, and `contain` letterboxes it
          // against the background rather than cutting the picture.
          style={{
            display: "block",
            width: "100%",
            height: "auto",
            maxHeight: 520,
            objectFit: "contain",
            background: "var(--raised, rgba(0,0,0,0.04))",
          }}
        />
      )}
      {post.kind === "link" && post.link_url && <LinkCard post={post} />}

      {/* Caption / text */}
      {post.text.trim() && (
        <div style={{ padding: "10px 14px 4px", fontSize: 14, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {post.text}
        </div>
      )}

      {/* Actions */}
      <div className="row" style={{ gap: 14, alignItems: "center", padding: "8px 14px" }}>
        <button
          type="button"
          onClick={like}
          aria-pressed={post.liked_by_me}
          style={{
            display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none",
            cursor: "pointer", padding: 0, color: post.liked_by_me ? "var(--danger)" : "var(--muted)", fontSize: 14, fontWeight: 700,
          }}
        >
          <span style={{ fontSize: 18 }}>{post.liked_by_me ? "♥" : "♡"}</span>
          {post.like_count > 0 && post.like_count}
        </button>
        <span className="small" style={{ color: "var(--muted)" }}>
          {post.comments.length} comment{post.comments.length === 1 ? "" : "s"}
        </span>
      </div>

      <Comments post={post} isAdmin={isAdmin} onChange={onChange} />
    </div>
  );
}

function LinkCard({ post }: { post: BulletinPost }) {
  let host = "";
  try { host = new URL(post.link_url!).hostname.replace(/^www\./, ""); } catch { /* noop */ }
  return (
    <a
      href={post.link_url!}
      target="_blank"
      rel="noreferrer"
      style={{ display: "block", textDecoration: "none", color: "inherit", borderTop: "1px solid var(--border)", borderBottom: "1px solid var(--border)" }}
    >
      {/* A link preview image is decorative chrome, not the crew's own photo, so
          `cover` stays here: it fills the card band cleanly and nobody is trying
          to read detail out of an OG thumbnail. */}
      {post.link_image_url && (
        <img src={post.link_image_url} alt="" style={{ display: "block", width: "100%", maxHeight: 320, objectFit: "cover" }} />
      )}
      <div style={{ padding: "10px 14px" }}>
        <div className="small" style={{ color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.04em", fontSize: 11 }}>{host}</div>
        <div style={{ fontWeight: 700, fontSize: 14, marginTop: 2 }}>{post.link_title || post.link_url}</div>
        {post.link_description && (
          <div className="small" style={{ color: "var(--muted)", marginTop: 2, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
            {post.link_description}
          </div>
        )}
      </div>
    </a>
  );
}

// ── Comments ────────────────────────────────────────────────────────────────
function Comments({
  post, isAdmin, onChange,
}: {
  post: BulletinPost;
  isAdmin: boolean;
  onChange: (p: BulletinPost) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const c = await addComment(post.post_uuid, t);
      onChange({ ...post, comments: [...post.comments, c] });
      setText("");
    } catch { /* leave the text so they can retry */ } finally {
      setBusy(false);
    }
  };

  const remove = async (c: BulletinComment) => {
    try {
      await removeComment(c.comment_uuid);
      onChange({ ...post, comments: post.comments.filter((x) => x.comment_uuid !== c.comment_uuid) });
    } catch { /* noop */ }
  };

  return (
    <div style={{ borderTop: "1px solid var(--border)", padding: "8px 14px 12px" }}>
      {post.comments.map((c) => (
        <div key={c.comment_uuid} className="row" style={{ gap: 6, alignItems: "baseline", padding: "3px 0" }}>
          <span style={{ fontSize: 13, minWidth: 0 }}>
            <strong>{c.author_name || "Someone"}</strong>{" "}
            <span style={{ wordBreak: "break-word" }}>{c.text}</span>
          </span>
          <span className="small" style={{ color: "var(--muted)", flexShrink: 0, marginLeft: "auto" }}>{timeAgo(c.created_at)}</span>
          {isAdmin && (
            <button type="button" onClick={() => remove(c)} title="Remove comment" style={{ color: "var(--danger)", fontSize: 11, flexShrink: 0 }}>×</button>
          )}
        </div>
      ))}
      <div className="row" style={{ gap: 8, marginTop: 6 }}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
          placeholder="Add a comment…"
          style={{ flex: 1, minWidth: 0, fontSize: 16, padding: "6px 10px" }}
        />
        <button type="button" onClick={submit} disabled={!text.trim() || busy} style={{ fontSize: 13 }}>
          {busy ? "…" : "Send"}
        </button>
      </div>
    </div>
  );
}
