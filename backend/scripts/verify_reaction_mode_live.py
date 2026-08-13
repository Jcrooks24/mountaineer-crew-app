"""Exercise the reaction-mode feature against a real SQLite database.

Not a source grep: this creates the schema, runs the ACTUAL migration's upgrade()
against a table built without the column, then drives the real endpoint functions
with real Session objects and asserts on rows. Covers what the static checks
cannot: that the migration applies, that a switch preserves reaction rows, that
the toggle still works in dislike mode, and that the round trip restores likes.
"""
import os
import sys
import warnings

warnings.filterwarnings("ignore", category=DeprecationWarning)

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BACKEND)
os.environ.setdefault("JWT_SECRET", "test")

from sqlalchemy import create_engine, text  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402

from app.db.session import Base  # noqa: E402
from app.db.models.bulletin import BulletinLike, BulletinPost  # noqa: E402
from app.db.models.user import User  # noqa: E402

FAILS = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{('   ' + detail) if detail else ''}")
    if not cond:
        FAILS.append(name)


engine = create_engine("sqlite://")
Base.metadata.create_all(engine)
Session = sessionmaker(bind=engine)
db = Session()

# ── The migration actually applies to a table that predates it ────────────────
print("The migration applies to a pre-existing table:")
with engine.begin() as conn:
    conn.execute(text("ALTER TABLE bulletin_posts DROP COLUMN reaction_mode"))
    cols = [r[1] for r in conn.execute(text("PRAGMA table_info(bulletin_posts)"))]
    check("column removed to simulate the old schema", "reaction_mode" not in cols)
    # A post written BEFORE the migration, so the backfill claim is tested.
    conn.execute(text(
        "INSERT INTO bulletin_posts (post_uuid, author_name, kind, text, created_at) "
        "VALUES ('old-post', 'Someone', 'text', 'before the migration', '2026-08-01 10:00:00')"
    ))

from alembic.operations import Operations  # noqa: E402
from alembic.migration import MigrationContext  # noqa: E402
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location(
    "mig", os.path.join(BACKEND, "alembic", "versions",
                        "h8j0l2g4i6k8_add_bulletin_reaction_mode.py"))
mig = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mig)

with engine.begin() as conn:
    ctx = MigrationContext.configure(conn)
    with Operations.context(ctx):
        mig.upgrade()
    cols = [r[1] for r in conn.execute(text("PRAGMA table_info(bulletin_posts)"))]
    check("upgrade() added the column", "reaction_mode" in cols)
    val = conn.execute(text(
        "SELECT reaction_mode FROM bulletin_posts WHERE post_uuid='old-post'")).scalar()
    check("a row that predates the migration defaults to 'like'", val == "like", repr(val))
    check("no backfill was needed for it to be non-null", val is not None)

# ── Drive the real endpoint functions ─────────────────────────────────────────
from app.routers.bulletin import (  # noqa: E402
    set_reaction_mode, toggle_like, ReactionModeIn, feed,
)
from fastapi import HTTPException  # noqa: E402
from datetime import datetime  # noqa: E402

owner = User(email="j.a.crooks24@gmail.com", name="Owner", role="crew",
             password_hash="x", is_active=True)
admin = User(email="boss@mountaineermoving.com", name="Boss", role="admin",
             password_hash="x", is_active=True)
crew = [User(email=f"crew{i}@x.com", name=f"Crew {i}", role="crew",
             password_hash="x", is_active=True) for i in range(3)]
db.add_all([owner, admin, *crew])
db.commit()

post = BulletinPost(post_uuid="p1", author_id=owner.id, author_name="Owner",
                    kind="text", text="hello", created_at=datetime.utcnow())
db.add(post)
db.commit()

print("\nThree crew like the post:")
for u in crew:
    toggle_like("p1", db, u)
db.commit()
likes = db.query(BulletinLike).filter(BulletinLike.post_id == post.id).count()
check("three like rows exist", likes == 3, str(likes))

print("\nEveryone except the owner is refused (the real endpoint, not the gate fn):")
for who, u in [("an admin", admin), ("a crew member", crew[0])]:
    try:
        set_reaction_mode("p1", ReactionModeIn(mode="dislike"), db, u)
        check(f"{who} is refused", False, "IT WAS ALLOWED")
    except HTTPException as e:
        check(f"{who} is refused with {e.status_code}", e.status_code == 404)

print("\nThe owner switches it to dislikes:")
r = set_reaction_mode("p1", ReactionModeIn(mode="dislike"), db, owner)
db.expire_all()
check("endpoint reports dislike", r["reaction_mode"] == "dislike")
check("count carried over", r["like_count"] == 3, str(r["like_count"]))
check("the reaction rows were NOT deleted",
      db.query(BulletinLike).filter(BulletinLike.post_id == post.id).count() == 3)
check("the column persisted",
      db.query(BulletinPost).filter_by(post_uuid="p1").first().reaction_mode == "dislike")

print("\nA fourth crew member dislikes it, and can un-dislike:")
u4 = User(email="crew4@x.com", name="Crew 4", role="crew", password_hash="x", is_active=True)
db.add(u4); db.commit()
r = toggle_like("p1", db, u4); db.commit()
check("dislike registered", r["like_count"] == 4, str(r["like_count"]))
check("toggle reports the post's mode", r.get("reaction_mode") == "dislike")
r = toggle_like("p1", db, u4); db.commit()
check("un-dislike works the same way", r["like_count"] == 3, str(r["like_count"]))

print("\nThe feed tells each viewer what to render:")
out = feed(None, 20, db, owner)
p = out["posts"][0]
check("owner sees the control", p["can_set_reaction_mode"] is True)
check("owner is told the mode", p["reaction_mode"] == "dislike")
out = feed(None, 20, db, admin)
check("an admin does NOT see the control",
      out["posts"][0]["can_set_reaction_mode"] is False)
out = feed(None, 20, db, crew[0])
check("a crew member does NOT see the control",
      out["posts"][0]["can_set_reaction_mode"] is False)
check("but crew still see the mode so the button renders right",
      out["posts"][0]["reaction_mode"] == "dislike")

print("\nSwitching back restores the original likes exactly (the reversibility claim):")
r = set_reaction_mode("p1", ReactionModeIn(mode="like"), db, owner)
check("back to like mode", r["reaction_mode"] == "like")
check("all three original likes are intact", r["like_count"] == 3, str(r["like_count"]))
rows = {l.user_id for l in db.query(BulletinLike).filter(BulletinLike.post_id == post.id)}
check("and they are the SAME three people", rows == {u.id for u in crew}, str(rows))

print("\nAn invalid mode is rejected, not stored:")
try:
    set_reaction_mode("p1", ReactionModeIn(mode="banana"), db, owner)
    check("invalid mode rejected", False, "IT WAS ACCEPTED")
except HTTPException as e:
    check(f"invalid mode rejected with {e.status_code}", e.status_code == 422)
db.expire_all()
check("mode unchanged after the bad request",
      db.query(BulletinPost).filter_by(post_uuid="p1").first().reaction_mode == "like")

print("\nThe other post is untouched (per-post, not global):")
p2 = BulletinPost(post_uuid="p2", author_id=owner.id, author_name="Owner",
                  kind="text", text="second", created_at=datetime.utcnow())
db.add(p2); db.commit()
set_reaction_mode("p1", ReactionModeIn(mode="dislike"), db, owner)
db.expire_all()
check("p1 is dislike", db.query(BulletinPost).filter_by(post_uuid="p1").first().reaction_mode == "dislike")
check("p2 is still like", db.query(BulletinPost).filter_by(post_uuid="p2").first().reaction_mode == "like")

print("\n" + (f"{len(FAILS)} FAILED: {', '.join(FAILS)}" if FAILS else "ALL PASS"))
sys.exit(1 if FAILS else 0)
