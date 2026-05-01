-- =============================================================================
-- MOUNTAINEER CREW APP — Full PostgreSQL Schema
-- Generated from Alembic migrations (acb818a08b24 → h6i7j8k9l0m1)
-- Paste this into your Supabase staging project's SQL Editor and run it.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. USERS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id               SERIAL PRIMARY KEY,
    email            VARCHAR NOT NULL UNIQUE,
    password_hash    VARCHAR NOT NULL,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    name             VARCHAR,
    role             VARCHAR NOT NULL DEFAULT 'user',
    reset_token      VARCHAR,
    reset_token_expiry TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS ix_users_id    ON users (id);
CREATE INDEX IF NOT EXISTS ix_users_email ON users (email);
CREATE INDEX IF NOT EXISTS ix_users_reset_token ON users (reset_token);

-- ---------------------------------------------------------------------------
-- 2. JOBS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS jobs (
    id                  SERIAL PRIMARY KEY,
    external_job_id     VARCHAR,
    client_name         VARCHAR NOT NULL,
    origin_address      VARCHAR,
    destination_address VARCHAR,
    scheduled_start     TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_jobs_id              ON jobs (id);
CREATE INDEX IF NOT EXISTS ix_jobs_external_job_id ON jobs (external_job_id);
CREATE INDEX IF NOT EXISTS ix_jobs_client_name     ON jobs (client_name);

-- ---------------------------------------------------------------------------
-- 3. EVENTS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS events (
    id         SERIAL PRIMARY KEY,
    event_id   VARCHAR NOT NULL UNIQUE,
    job_uuid   VARCHAR,
    job_id     INTEGER REFERENCES jobs (id),
    type       VARCHAR NOT NULL,
    timestamp  TIMESTAMP NOT NULL,
    logged_at  TIMESTAMP NOT NULL,
    lat        DOUBLE PRECISION,
    lng        DOUBLE PRECISION,
    accuracy_m DOUBLE PRECISION,
    note       VARCHAR,
    synced     BOOLEAN NOT NULL DEFAULT FALSE,
    job_name   VARCHAR,
    created_by VARCHAR
);

CREATE INDEX IF NOT EXISTS ix_events_id       ON events (id);
CREATE INDEX IF NOT EXISTS ix_events_event_id ON events (event_id);
CREATE INDEX IF NOT EXISTS ix_events_job_uuid ON events (job_uuid);
CREATE INDEX IF NOT EXISTS ix_events_job_id   ON events (job_id);
CREATE INDEX IF NOT EXISTS ix_events_type     ON events (type);

-- ---------------------------------------------------------------------------
-- 4. SHEET EXPORT DEDUP TABLES
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sheet_event_exports (
    event_id    TEXT PRIMARY KEY,
    exported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sheet_material_exports (
    export_key  TEXT PRIMARY KEY,
    exported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ---------------------------------------------------------------------------
-- 5. SYSTEM CONFIG (key/value store)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_config (
    key   VARCHAR PRIMARY KEY,
    value TEXT
);

-- ---------------------------------------------------------------------------
-- 6. CALENDAR JOBS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calendar_jobs (
    calendar_event_id VARCHAR PRIMARY KEY,
    job_uuid          VARCHAR NOT NULL UNIQUE,
    created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_calendar_jobs_calendar_event_id ON calendar_jobs (calendar_event_id);
CREATE INDEX IF NOT EXISTS ix_calendar_jobs_job_uuid          ON calendar_jobs (job_uuid);

-- ---------------------------------------------------------------------------
-- 7. PHOTOS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS photos (
    id            VARCHAR PRIMARY KEY,
    job_uuid      VARCHAR NOT NULL,
    created_by    VARCHAR NOT NULL DEFAULT '',
    caption       VARCHAR NOT NULL DEFAULT '',
    drive_file_id VARCHAR NOT NULL,
    drive_url     VARCHAR NOT NULL,
    mime_type     VARCHAR NOT NULL DEFAULT 'image/jpeg',
    created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS ix_photos_job_uuid ON photos (job_uuid);

-- ---------------------------------------------------------------------------
-- 8. MATERIALS SUBMISSIONS
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS materials_submissions (
    id            SERIAL PRIMARY KEY,
    submission_id VARCHAR NOT NULL UNIQUE,
    created_at    TIMESTAMP NOT NULL,
    job_uuid      VARCHAR NOT NULL,
    job_label     VARCHAR,
    job_name      VARCHAR,
    job_date      VARCHAR,
    notes         VARCHAR,
    items_json    VARCHAR NOT NULL DEFAULT '[]',
    total         NUMERIC(10, 2) NOT NULL DEFAULT 0.0
);

CREATE INDEX IF NOT EXISTS ix_materials_submissions_id            ON materials_submissions (id);
CREATE INDEX IF NOT EXISTS ix_materials_submissions_submission_id ON materials_submissions (submission_id);
CREATE INDEX IF NOT EXISTS ix_materials_submissions_job_uuid      ON materials_submissions (job_uuid);

-- ---------------------------------------------------------------------------
-- 9. ALEMBIC VERSION TABLE
--    Tells Alembic the DB is already at the latest migration head,
--    so it won't re-run migrations on first staging deploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alembic_version (
    version_num VARCHAR(32) NOT NULL PRIMARY KEY
);

INSERT INTO alembic_version (version_num)
VALUES ('h6i7j8k9l0m1')
ON CONFLICT DO NOTHING;

-- =============================================================================
-- NOTE ON RLS / ROW-LEVEL SECURITY
-- =============================================================================
-- This app does NOT use Supabase's RLS — all data access goes through the
-- FastAPI backend (Render), which connects to Supabase as a direct PostgreSQL
-- client using DATABASE_URL. The backend enforces auth via JWT + role checks.
-- You do NOT need to configure RLS policies on the staging project.
-- If you want to lock down the Supabase dashboard anyway, you can enable RLS
-- on each table and add a policy like:
--   CREATE POLICY "service role only" ON <table> USING (false);
-- Then only the service role (used by DATABASE_URL) can bypass it.
-- =============================================================================
