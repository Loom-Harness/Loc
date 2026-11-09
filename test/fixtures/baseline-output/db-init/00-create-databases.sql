-- Auto-generated.
-- Idempotent: runs on a fresh volume (docker-entrypoint-initdb.d) AND on
-- every `docker compose up` (the db-bootstrap service), so a deployable
-- added in a later generation still gets its database.
SELECT 'CREATE DATABASE "primary_sql"' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'primary_sql')\gexec
