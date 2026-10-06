-- Auto-generated.
-- Idempotent: runs on a fresh volume (docker-entrypoint-initdb.d) AND on
-- every `docker compose up` (the db-bootstrap service), so a deployable
-- added in a later generation still gets its database.
SELECT 'CREATE DATABASE api' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'api')\gexec
SELECT 'CREATE DATABASE catalog_web' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'catalog_web')\gexec
SELECT 'CREATE DATABASE catalog_api' WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'catalog_api')\gexec
