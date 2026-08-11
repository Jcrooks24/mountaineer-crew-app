"""
Company Bulletin - a lightweight community feed ("Instagram-lite").

Crew share photo, link, and text posts; everyone can like and comment. It is a
community-building tool, deliberately lower-stakes than the core app: no Google
Sheets export, and posts are best-effort (not the offline-first queue the
irreplaceable data paths use). Admins can soft-remove posts or comments for
moderation - rows are kept (removed_at set) rather than hard-deleted.

Idempotency: posts and comments carry a client-minted UUID so a double-tap or a
retried request doesn't create duplicates.
"""

from sqlalchemy import Column, DateTime, Integer, LargeBinary, String, Text, UniqueConstraint

from app.db.session import Base


class BulletinPost(Base):
    __tablename__ = "bulletin_posts"

    id = Column(Integer, primary_key=True, index=True)
    post_uuid = Column(String, unique=True, index=True, nullable=False)

    author_id = Column(Integer, nullable=True, index=True)
    author_name = Column(String, nullable=False, default="")

    # "photo" | "link" | "text"
    kind = Column(String, nullable=False, default="text")

    # The blurb / caption (all kinds may carry text).
    text = Column(Text, nullable=False, default="")

    # Photo posts: the image is stored server-side (bytes + mime), served from a
    # capability URL keyed by post_uuid. Server-only and transient - no Drive.
    image_bytes = Column(LargeBinary, nullable=True)
    image_mime = Column(String, nullable=True)
    # Legacy: earlier photo posts uploaded to Drive. Kept so those still render.
    image_drive_file_id = Column(String, nullable=True)
    image_drive_url = Column(String, nullable=True)
    image_thumb_url = Column(String, nullable=True)

    # Link posts: the shared URL + fetched OpenGraph preview.
    link_url = Column(String, nullable=True)
    link_title = Column(String, nullable=True)
    link_description = Column(Text, nullable=True)
    link_image_url = Column(String, nullable=True)

    created_at = Column(DateTime, nullable=False, index=True)

    # Soft moderation: kept, not deleted, so removal is auditable.
    removed_at = Column(DateTime, nullable=True)
    removed_by = Column(String, nullable=True)


class BulletinLike(Base):
    __tablename__ = "bulletin_likes"
    __table_args__ = (UniqueConstraint("post_id", "user_id", name="uq_bulletin_like"),)

    id = Column(Integer, primary_key=True, index=True)
    post_id = Column(Integer, nullable=False, index=True)
    user_id = Column(Integer, nullable=False, index=True)
    created_at = Column(DateTime, nullable=False)


class BulletinComment(Base):
    __tablename__ = "bulletin_comments"

    id = Column(Integer, primary_key=True, index=True)
    comment_uuid = Column(String, unique=True, index=True, nullable=False)

    post_id = Column(Integer, nullable=False, index=True)
    author_id = Column(Integer, nullable=True)
    author_name = Column(String, nullable=False, default="")
    text = Column(Text, nullable=False, default="")

    created_at = Column(DateTime, nullable=False)
    removed_at = Column(DateTime, nullable=True)
    removed_by = Column(String, nullable=True)
