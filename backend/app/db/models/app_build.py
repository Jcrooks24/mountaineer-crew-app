"""AppBuild - one row per frontend build the crew has actually loaded.

The build identity already existed in the bundle: `__APP_BUILD_ID__` (commit sha
plus a build timestamp) and `__APP_VERSION_NAME__` (a deterministic two-word
name like "Brave Otter"), both baked in by vite.config.ts. What did not exist was
any server-side record that a build happened, so patch notes read as a list of
announcements rather than a version history - and a build shipped without a note
left no trace at all.

Rows are created by the client reporting its own build on load. That means this
table records builds that were REACHED BY A CREW DEVICE, not builds that were
deployed. Those are different things and the difference is the useful one: a
build nobody ever loaded is not part of the crew's history, and a build that
never reaches a device is a deployment problem this table would show as an
absence.
"""

from sqlalchemy import Column, DateTime, Integer, String

from app.db.session import Base


class AppBuild(Base):
    __tablename__ = "app_builds"

    id = Column(Integer, primary_key=True, index=True)

    # The precise identifier: "<short sha>-<build stamp>", or "dev-<stamp>" for a
    # local build. Unique, because it IS the build's identity.
    build_id = Column(String, unique=True, index=True, nullable=False)

    # The friendly name derived from build_id ("Brave Otter"). Stored rather than
    # re-derived so the history keeps reading correctly even if the adjective or
    # noun lists in vite.config.ts are ever edited - the name a crew member saw
    # is the name the history should show.
    version_name = Column(String, nullable=False)

    # When a device first and most recently reported this build. `first_seen_at`
    # orders the history; `last_seen_at` says whether anyone is still on it,
    # which is how you spot a device stuck on an old bundle.
    first_seen_at = Column(DateTime, nullable=False, index=True)
    last_seen_at = Column(DateTime, nullable=False)
