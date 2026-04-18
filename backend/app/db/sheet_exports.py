from sqlalchemy import text
from sqlalchemy.engine import Engine

def ensure_sheet_exports_tables(engine: Engine) -> None:
    """
    Creates export tracking tables if they don't exist.
    We use raw SQL to avoid adding ORM models/import wiring.
    """
    with engine.begin() as conn:
        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS sheet_event_exports (
            event_id TEXT PRIMARY KEY,
            exported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """))

        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS sheet_material_exports (
            export_key TEXT PRIMARY KEY,
            exported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        """))

        # Generic dedup table for any other sheet export.
        # Key is (kind, export_key) — e.g. ("job_report", "<job_uuid>:<updated_at>").
        conn.execute(text("""
        CREATE TABLE IF NOT EXISTS sheet_generic_exports (
            kind TEXT NOT NULL,
            export_key TEXT NOT NULL,
            exported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (kind, export_key)
        );
        """))
