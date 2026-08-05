"""
Company Bulletin API - a community feed (photo / link / text posts, likes,
comments). Deliberately lighter than the core app: no Sheets export, best-effort
posting, soft moderation. Everything is JWT-protected; removals are admin-only.
"""
from collections import defaultdict
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.deps import get_current_user, get_db, require_admin
from app.core.link_preview import fetch_link_preview
from app.db.models.bulletin import BulletinComment, BulletinLike, BulletinPost
from app.db.models.user import User
from app.integrations.drive_upload import upload_photo_to_drive

router = APIRouter(prefix="/api/bulletin", tags=["bulletin"])

FEED_PAGE = 20
MAX_TEXT = 5000


def _comment_out(c: BulletinComment) -> dict:
    return {
        "comment_uuid": c.comment_uuid,
        "author_id": c.author_id,
        "author_name": c.author_name,
        "text": c.text,
        "created_at": c.created_at.isoformat(),
    }


def _post_out(p: BulletinPost, like_count: int, liked: bool, comments: list) -> dict:
    return {
        "post_uuid": p.post_uuid,
        "author_id": p.author_id,
        "author_name": p.author_name,
        "kind": p.kind,
        "text": p.text,
        "image_url": p.image_drive_url,
        "image_thumb_url": p.image_thumb_url,
        "link_url": p.link_url,
        "link_title": p.link_title,
        "link_description": p.link_description,
        "link_image_url": p.link_image_url,
        "created_at": p.created_at.isoformat(),
        "like_count": like_count,
        "liked_by_me": liked,
        "comments": comments,
    }


@router.get("/feed")
def feed(
    before_id: Optional[int] = Query(default=None),
    limit: int = Query(default=FEED_PAGE, ge=1, le=50),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Newest-first page of non-removed posts, with like counts, whether the
    caller liked each, and the (non-removed) comments. `before_id` cursors older."""
    q = db.query(BulletinPost).filter(BulletinPost.removed_at.is_(None))
    if before_id is not None:
        q = q.filter(BulletinPost.id < before_id)
    posts = q.order_by(BulletinPost.id.desc()).limit(limit).all()
    if not posts:
        return {"posts": [], "next_before_id": None}

    ids = [p.id for p in posts]

    # Batch the likes + comments for the page (no per-post query).
    like_counts: dict[int, int] = dict(
        db.query(BulletinLike.post_id, func.count(BulletinLike.id))
        .filter(BulletinLike.post_id.in_(ids))
        .group_by(BulletinLike.post_id)
        .all()
    )
    my_likes = {
        pid for (pid,) in db.query(BulletinLike.post_id)
        .filter(BulletinLike.post_id.in_(ids), BulletinLike.user_id == current_user.id)
        .all()
    }
    comments_by_post: dict[int, list] = defaultdict(list)
    for c in (
        db.query(BulletinComment)
        .filter(BulletinComment.post_id.in_(ids), BulletinComment.removed_at.is_(None))
        .order_by(BulletinComment.id.asc())
        .all()
    ):
        comments_by_post[c.post_id].append(_comment_out(c))

    out = [
        _post_out(p, int(like_counts.get(p.id, 0)), p.id in my_likes, comments_by_post.get(p.id, []))
        for p in posts
    ]
    return {"posts": out, "next_before_id": ids[-1] if len(posts) == limit else None}


class PostIn(BaseModel):
    post_uuid: str
    kind: str  # "text" | "link"
    text: str = ""
    link_url: Optional[str] = None


@router.post("/posts")
def create_post(
    body: PostIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a text or link post. (Photo posts use /posts/photo.) Idempotent on
    post_uuid - a retry returns the existing post."""
    existing = db.query(BulletinPost).filter(BulletinPost.post_uuid == body.post_uuid).first()
    if existing:
        return _post_out(existing, 0, False, [])

    kind = body.kind if body.kind in ("text", "link") else "text"
    text = (body.text or "").strip()[:MAX_TEXT]

    link_url = link_title = link_desc = link_image = None
    if kind == "link":
        link_url = (body.link_url or "").strip()
        if not link_url:
            raise HTTPException(status_code=422, detail="A link post needs a URL.")
        preview = fetch_link_preview(link_url)
        link_title = preview.get("title")
        link_desc = preview.get("description")
        link_image = preview.get("image")
    elif not text:
        raise HTTPException(status_code=422, detail="A text post needs some text.")

    post = BulletinPost(
        post_uuid=body.post_uuid,
        author_id=current_user.id,
        author_name=(current_user.name or current_user.email or "").strip(),
        kind=kind,
        text=text,
        link_url=link_url,
        link_title=link_title,
        link_description=link_desc,
        link_image_url=link_image,
        created_at=datetime.utcnow(),
    )
    db.add(post)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # raced the same post_uuid
        post = db.query(BulletinPost).filter(BulletinPost.post_uuid == body.post_uuid).first()
    return _post_out(post, 0, False, [])


@router.post("/posts/photo")
def create_photo_post(
    file: UploadFile = File(...),
    post_uuid: str = Form(...),
    text: str = Form(default=""),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a photo post: the image goes to Drive under a Bulletin folder, then
    a post row. Idempotent on post_uuid (a retry does not re-upload)."""
    existing = db.query(BulletinPost).filter(BulletinPost.post_uuid == post_uuid).first()
    if existing:
        return _post_out(existing, 0, False, [])

    mime_type = file.content_type or "image/jpeg"
    try:
        result = upload_photo_to_drive(
            db=db,
            file_obj=file.file,
            filename=post_uuid,
            mime_type=mime_type,
            job_name="Bulletin",
            job_date="",
            caption=(text or "").strip()[:200],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Image upload failed: {e}")

    post = BulletinPost(
        post_uuid=post_uuid,
        author_id=current_user.id,
        author_name=(current_user.name or current_user.email or "").strip(),
        kind="photo",
        text=(text or "").strip()[:MAX_TEXT],
        image_drive_file_id=result["file_id"],
        image_drive_url=result["url"],
        image_thumb_url=result["thumb_url"],
        created_at=datetime.utcnow(),
    )
    db.add(post)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        post = db.query(BulletinPost).filter(BulletinPost.post_uuid == post_uuid).first()
    return _post_out(post, 0, False, [])


def _require_post(db: Session, post_uuid: str) -> BulletinPost:
    p = db.query(BulletinPost).filter(BulletinPost.post_uuid == post_uuid).first()
    if not p or p.removed_at is not None:
        raise HTTPException(status_code=404, detail="Post not found.")
    return p


@router.post("/posts/{post_uuid}/like")
def toggle_like(
    post_uuid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Toggle the caller's like on a post. Returns the new state + count."""
    post = _require_post(db, post_uuid)
    row = (
        db.query(BulletinLike)
        .filter(BulletinLike.post_id == post.id, BulletinLike.user_id == current_user.id)
        .first()
    )
    if row:
        db.delete(row)
        liked = False
    else:
        db.add(BulletinLike(post_id=post.id, user_id=current_user.id, created_at=datetime.utcnow()))
        liked = True
    try:
        db.commit()
    except IntegrityError:
        db.rollback()  # raced a concurrent like; treat as liked
        liked = True
    count = db.query(func.count(BulletinLike.id)).filter(BulletinLike.post_id == post.id).scalar() or 0
    return {"liked": liked, "like_count": int(count)}


class CommentIn(BaseModel):
    comment_uuid: str
    text: str = ""


@router.post("/posts/{post_uuid}/comments")
def add_comment(
    post_uuid: str,
    body: CommentIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Add a comment. Idempotent on comment_uuid."""
    post = _require_post(db, post_uuid)
    text = (body.text or "").strip()[:MAX_TEXT]
    if not text:
        raise HTTPException(status_code=422, detail="Empty comment.")
    existing = db.query(BulletinComment).filter(BulletinComment.comment_uuid == body.comment_uuid).first()
    if existing:
        return _comment_out(existing)
    c = BulletinComment(
        comment_uuid=body.comment_uuid,
        post_id=post.id,
        author_id=current_user.id,
        author_name=(current_user.name or current_user.email or "").strip(),
        text=text,
        created_at=datetime.utcnow(),
    )
    db.add(c)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        c = db.query(BulletinComment).filter(BulletinComment.comment_uuid == body.comment_uuid).first()
    return _comment_out(c)


@router.delete("/posts/{post_uuid}")
def remove_post(
    post_uuid: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Admin soft-removes a post (kept in the DB, hidden from the feed)."""
    p = db.query(BulletinPost).filter(BulletinPost.post_uuid == post_uuid).first()
    if not p:
        raise HTTPException(status_code=404, detail="Post not found.")
    if p.removed_at is None:
        p.removed_at = datetime.utcnow()
        p.removed_by = (admin.name or admin.email or "admin")
        db.commit()
    return {"ok": True}


@router.delete("/comments/{comment_uuid}")
def remove_comment(
    comment_uuid: str,
    db: Session = Depends(get_db),
    admin: User = Depends(require_admin),
):
    """Admin soft-removes a comment."""
    c = db.query(BulletinComment).filter(BulletinComment.comment_uuid == comment_uuid).first()
    if not c:
        raise HTTPException(status_code=404, detail="Comment not found.")
    if c.removed_at is None:
        c.removed_at = datetime.utcnow()
        c.removed_by = (admin.name or admin.email or "admin")
        db.commit()
    return {"ok": True}
