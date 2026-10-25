import { execSync, spawn } from "node:child_process";
import * as path from "node:path";
import { describe, it } from "vitest";
import {
  type BackendDriver,
  handleFor,
  type PgConn,
  runMigrationEvolutionGate,
  runUniqueIndexEvolutionGate,
} from "./support/migration-evolution-harness.js";

// ---------------------------------------------------------------------------
// Migration-evolution gate (M-T2.13) — PYTHON/FastAPI/SQLAlchemy backend.
// Sibling of migration-evolution.test.ts; same fixtures + shared checks, only
// the boot differs (uv sync + uvicorn).  Migrations apply at boot via the
// FastAPI lifespan `run_migrations()` (the `__loom_migrations` tracking table).
//
// Opt-in: LOOM_MIGRATION_E2E_PYTHON=1.  Needs `uv` + docker (postgres sidecar)
// or LOOM_MIGRATION_PG_URL, plus host `psql`.
// ---------------------------------------------------------------------------

const ENABLED = process.env.LOOM_MIGRATION_E2E_PYTHON === "1";

const pythonDriver: BackendDriver = {
  platform: "python",
  toolchain: {
    name: "uv",
    check: () => {
      try {
        execSync("uv --version", { stdio: "pipe", timeout: 15_000 });
        return true;
      } catch {
        return false;
      }
    },
  },
  install(appDir) {
    execSync("uv sync", { cwd: appDir, stdio: "pipe", timeout: 300_000 });
  },
  boot(appDir, pg: PgConn, port) {
    const url = `postgresql+asyncpg://${pg.user}:${pg.password}@${pg.host}:${pg.port}/${pg.db}`;
    const child = spawn(
      path.join(appDir, ".venv", "bin", "python"),
      ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", String(port)],
      {
        cwd: appDir,
        env: { ...process.env, DATABASE_URL: url, PORT: String(port) },
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      },
    );
    return handleFor(child, `http://127.0.0.1:${port}`).handle;
  },
  readyTimeoutMs: 120_000,
};

describe.skipIf(!ENABLED)(
  "migration-evolution gate over the generated python backend (LOOM_MIGRATION_E2E_PYTHON=1)",
  () => {
    it("migrate-chain ≡ fresh-create, and seeded rows survive forward-migrate", async () => {
      await runMigrationEvolutionGate(pythonDriver);
    }, 600_000);
  },
);

// #3229 — `unique (…)` across a softDeletable flip (full → partial → full) and
// across inheritance (a TPC base's key on each concrete table; a TPH base's key
// mapped to 409 on each concrete route).  See `runUniqueIndexEvolutionGate`.
describe.skipIf(!ENABLED)("unique-index evolution gate over the generated python backend", () => {
  it("rebuilds the index across a softDeletable flip; inherited keys enforce per table / hierarchy", async () => {
    await runUniqueIndexEvolutionGate(pythonDriver);
  }, 600_000);
});
