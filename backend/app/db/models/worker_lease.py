"""WorkerLease - single-flight for background sweeps, without session affinity.

The auto-reconciler used `pg_try_advisory_lock`. That is a SESSION-scoped lock,
and it only guarantees single-flight while every statement of the cycle runs on
the same backend connection.

Staging connects through Supabase's Supavisor in TRANSACTION mode
(`pooler.supabase.com:6543`), where the connection returns to the pool at each
commit and the next statement may be served by a different backend. The
reconcile cycle commits partway through (`export_events_to_sheets` writes its
dedupe markers and commits), so from that point the lock protected nothing:
two workers could each believe they held it, or a lock could strand on a pooled
backend and never be released - quietly stopping the reconciler altogether.

Production is a Render Postgres, a direct connection, where the advisory lock
does behave. So this was never a production defect. It made STAGING behave
differently from prod, which is worse than it sounds: staging exists to rehearse
prod's durability, and a rehearsal with different semantics is a weak one.

A lease is just a row, so it does not care how the connection is pooled. It also
survives a worker being killed mid-cycle - the lease expires on its own, where a
stranded advisory lock would not.
"""

from sqlalchemy import Column, DateTime, Integer, String

from app.db.session import Base


class WorkerLease(Base):
    __tablename__ = "worker_leases"

    id = Column(Integer, primary_key=True, index=True)

    # What is being single-flighted, e.g. "auto_reconcile". One row per job.
    name = Column(String, unique=True, index=True, nullable=False)

    # Who holds it, for diagnosis only - never for correctness. A hostname/pid
    # tells you which worker is sweeping when you are staring at a log.
    holder = Column(String, nullable=True)

    # The lease is held until this instant. Expiry is what makes a killed worker
    # recoverable: nothing has to notice the death, the clock does it.
    #
    # Compared against the DATABASE's clock, never the worker's - two workers
    # with skewed clocks would otherwise disagree about who holds it.
    expires_at = Column(DateTime, nullable=False, index=True)

    updated_at = Column(DateTime, nullable=False)
