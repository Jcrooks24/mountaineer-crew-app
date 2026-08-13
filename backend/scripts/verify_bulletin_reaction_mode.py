"""Verify the per-post bulletin reaction mode, and above all its gate.

    python backend/scripts/verify_bulletin_reaction_mode.py

The feature is "a control only one person can see". The dangerous way to build
that is to hide a button, because hiding a button stops nobody who can type a
URL. These checks care mostly about the SERVER refusing everyone else, and about
the client not being the thing that decides.

No Postgres or FastAPI app needed: the gate is a pure function and the rest is
asserted against the source.
"""

import io
import os
import sys

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(BACKEND)
sys.path.insert(0, BACKEND)

FAILS = []


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}{('   ' + detail) if detail else ''}")
    if not cond:
        FAILS.append(name)


def read(*parts):
    return io.open(os.path.join(ROOT, *parts), encoding="utf-8").read()


from app.routers.bulletin import (  # noqa: E402
    BULLETIN_REACTION_MODE_EMAIL,
    REACTION_MODES,
    can_set_reaction_mode,
)


class FakeUser:
    def __init__(self, email, role="crew"):
        self.email = email
        self.role = role


print("Exactly one person passes the gate:")
check("the owner passes", can_set_reaction_mode(FakeUser("j.a.crooks24@gmail.com")))
check("different capitalisation is the same mailbox",
      can_set_reaction_mode(FakeUser("J.A.Crooks24@Gmail.com")))
check("stray whitespace does not lock the owner out",
      can_set_reaction_mode(FakeUser("  j.a.crooks24@gmail.com  ")))

print("\nEveryone else is refused, including admins:")
# An admin is the interesting case: every other privileged thing in this app is
# role-gated, so "admin can do it" is the mistake this feature invites.
check("an admin is refused", not can_set_reaction_mode(FakeUser("boss@x.com", "admin")))
check("the work account is refused",
      not can_set_reaction_mode(FakeUser("management@mountaineermoving.com", "admin")))
check("a crew member is refused", not can_set_reaction_mode(FakeUser("crew@x.com")))
check("no email at all is refused", not can_set_reaction_mode(FakeUser(None)))
check("empty email is refused", not can_set_reaction_mode(FakeUser("")))
check("a lookalike address is refused",
      not can_set_reaction_mode(FakeUser("j.a.crooks24@gmail.com.evil.com")))
check("a prefix of the address is refused",
      not can_set_reaction_mode(FakeUser("j.a.crooks24@gmail.co")))
check("substring matching is not used",
      not can_set_reaction_mode(FakeUser("xj.a.crooks24@gmail.comx")))

print("\nThe rule lives server-side only:")
router = read("backend", "app", "routers", "bulletin.py")
check("the address appears exactly once in the backend",
      router.count(BULLETIN_REACTION_MODE_EMAIL) == 1,
      f"{router.count(BULLETIN_REACTION_MODE_EMAIL)} occurrences")
for rel in [("frontend", "src", "pages", "Bulletin.tsx"),
            ("frontend", "src", "lib", "bulletin.ts")]:
    src = read(*rel)
    check(f"{rel[-1]} does not contain the address",
          "crooks24" not in src.lower())
    check(f"{rel[-1]} does not hardcode any email comparison",
          "@gmail" not in src.lower())

print("\nThe endpoint enforces it, not the UI:")
check("the endpoint checks the gate",
      "if not can_set_reaction_mode(current_user):" in router)
check("and it 404s rather than 403s",
      'raise HTTPException(status_code=404, detail="Not found")' in router,
      "a 403 would confirm the feature exists")
check("mode is validated against a whitelist",
      "if mode not in REACTION_MODES:" in router)
check("only two modes exist", tuple(REACTION_MODES) == ("like", "dislike"))

print("\nThe client is told what to render, it does not decide:")
check("the flag is computed server-side", '"can_set_reaction_mode": can_set_mode' in router)
check("the mode ships with every post", '"reaction_mode": p.reaction_mode or "like"' in router)
check("the feed computes the flag once for the page",
      "can_set_mode = can_set_reaction_mode(current_user)" in router)
page = read("frontend", "src", "pages", "Bulletin.tsx")
check("the control renders only on the server's say-so",
      "{post.can_set_reaction_mode && (" in page)
check("the button label follows the post's mode",
      'disliking ? "Enable likes" : "Disable likes"' in page)
check("mode is per post, not global",
      "setReactionMode(post.post_uuid, next)" in page)

print("\nExisting reactions are reinterpreted, never destroyed:")
check("the endpoint does not delete reaction rows",
      "delete(" not in router.split("def set_reaction_mode")[1].split("@router")[0],
      "switching a post must not touch bulletin_likes")
check("the user is warned what the switch means to the people who liked it",
      "which is not what they pressed" in page)
check("and told it is reversible", "Switching back restores the likes" in page)

print("\nThe migration is safe on a live table:")
mig = read("backend", "alembic", "versions", "h8j0l2g4i6k8_add_bulletin_reaction_mode.py")
check("has a server_default so existing rows need no backfill",
      "server_default='like'" in mig)
check("is NOT NULL", "nullable=False" in mig)
check("chains from the real head", "down_revision: Union[str, Sequence[str], None] = 'g7i9k1f3h5j7'" in mig)

print("\n" + (f"{len(FAILS)} FAILED: {', '.join(FAILS)}" if FAILS else "ALL PASS"))
sys.exit(1 if FAILS else 0)
