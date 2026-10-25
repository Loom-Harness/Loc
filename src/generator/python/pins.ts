// ---------------------------------------------------------------------------
// python@v1 — dependency pins (the version-owned slice of the backend;
// mirrors `src/platform/hono/v5/pins.ts`).  PEP 508 requirement strings
// spliced into the generated `pyproject.toml`.
//
// All ranges are within-major.  The `LOOM_PYTHON_BUILD` gate
// (`uv sync` + `ruff check` + `mypy --strict` against an emitted
// project) is what proves these resolve + typecheck together.
// ---------------------------------------------------------------------------
export const PYTHON_PINS = {
  dependencies: [
    "fastapi==0.162.0",
    "uvicorn[standard]==0.54.0",
    "sqlalchemy[asyncio]==2.1.6",
    "asyncpg==0.32.0",
    "pydantic==2.14.1",
    // UUIDv7 (time-ordered ids) — stdlib `uuid.uuid7` only lands in 3.14;
    // `uuid6` backports it (`from uuid6 import uuid7`) and is typed.
    "uuid6==2025.0.1",
    // Prometheus metrics (GET /metrics) — ships type stubs (py.typed).
    "prometheus-client==0.26.0",
    // OpenTelemetry tracing (M-T7.1): the request middleware opens a SERVER
    // span per request; exported via OTLP/HTTP only when a collector endpoint
    // is set (app/obs/tracing.py).
    "opentelemetry-api==1.45.1",
    "opentelemetry-sdk==1.45.1",
    "opentelemetry-exporter-otlp-proto-http==1.45.1",
  ],
  devDependencies: ["mypy==1.20.2", "ruff==0.17.2", "pytest==8.4.2", "pytest-asyncio==1.4.0"],
} as const;
