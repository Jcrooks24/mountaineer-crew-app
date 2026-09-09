"""A finalized payroll period.

WHY THIS EXISTS. Until now the app remembered only the LATEST finalized period,
as a JSON blob in `system_config` (`core/payroll_period.py`), because the only
question anyone asked of it was "where does the crew's current pay window
start?". Which periods have been finalized, and when, was not recorded anywhere.

Two things need it:

  1. The Payroll worksheet export. It writes one row per employee per period, so
     "which periods should be on that tab?" has to be answerable. Without this
     table the backfill audit cannot enumerate what SHOULD be there, and a sync
     nobody can audit is one whose stranded rows are invisible - the exact hole
     `sheet_backfill` exists to close.
  2. "When was this period run, and by whom?" A payroll period is a money event
     and it left no trace of having happened.

One row per (period_start, period_end). Re-finalizing a period - which the admin
does whenever one more correction turns up - UPDATES the row rather than adding
one, so the ledger stays one-row-per-period and `finalized_at` means "most
recently run", which is what matters for re-driving the export.
"""

from sqlalchemy import Column, DateTime, Integer, String, Text, UniqueConstraint

from app.db.session import Base


class PayrollRun(Base):
    __tablename__ = "payroll_runs"
    __table_args__ = (
        UniqueConstraint("period_start", "period_end", name="uq_payroll_runs_period"),
    )

    id = Column(Integer, primary_key=True, index=True)

    # ISO YYYY-MM-DD, inclusive. Strings to match every other date in this app.
    period_start = Column(String(10), nullable=False, index=True)
    period_end = Column(String(10), nullable=False)

    # Most recent finalize of this period, not the first.
    finalized_at = Column(DateTime, nullable=False)
    finalized_by_name = Column(String, nullable=True)

    # How many times it has been run. A period finalized repeatedly usually means
    # corrections kept arriving after the fact, which is worth being able to see.
    run_count = Column(Integer, nullable=False, server_default="1", default=1)

    # The rows written to the Payroll worksheet for this run, as JSON.
    #
    # A SNAPSHOT, not a cache. The mirror must show what was FINALIZED, and
    # rebuilding the summary at export time does not: a correction entered after
    # a finalize but before a re-finalize changes what the summary returns, so a
    # backfill re-drive weeks later would push figures to the sheet that were
    # never finalized by anybody. Money that was decided is not recomputed.
    #
    # Overwritten on a re-finalize, which is the one event that legitimately
    # changes what a period paid.
    #
    # Nullable: runs recorded before this column existed have none, and
    # `_queue_payroll_export` refuses to invent them rather than falling back to
    # live figures.
    rows_json = Column(Text, nullable=True)

    # What the payroll notes field said when this run was finalized.
    #
    # A SNAPSHOT, like rows_json and for the same reason. The note is ONE ROLLING
    # note that carries across periods and keeps being edited, so re-reading it
    # later would publish what it says NOW rather than what it said when this
    # payroll was run - and a backfill re-drive would quietly rewrite history.
    #
    # Nullable: runs finalized before the field existed have none.
    notes_snapshot = Column(Text, nullable=True)

    @property
    def period_key(self) -> str:
        """The value written into the Payroll tab's key column, and the key the
        backfill audit matches on."""
        return f"{self.period_start}..{self.period_end}"
