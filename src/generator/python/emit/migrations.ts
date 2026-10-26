import type { MigrationStep, MigrationsIR } from "../../../ir/types/migrations-ir.js";
import { splitTransactionalSteps } from "../../../ir/util/migration-steps.js";
import { snake } from "../../../util/naming.js";
import { BOOT_DB_RETRY } from "../../_obs/boot-db-retry.js";
import { NO_TRANSACTION_MARKER, renderPgStep, splitPgStatements } from "../../sql-pg.js";

// ---------------------------------------------------------------------------
// Python migration emitter — the Drizzle-runtime-migrator pattern with
// the shared Postgres DDL renderer (`sql-pg.ts`, bit-identical with
// Hono/.NET):
//
//   migrations/<version>_<module>_<name>.sql   one per MigrationsIR
//   app/db/migrate.py                          boot-time runner (emitted
//                                              by the orchestrator)
//
// Statements are separated by the `--> statement-breakpoint` sentinel.
// Unlike node-postgres, asyncpg can't run multi-statement strings, so
// each step's rendered SQL is ALSO split into individual statements at
// generation time — every breakpoint chunk is exactly one statement.
//
// Application: `run_migrations()` (called from the FastAPI lifespan)
// creates a `__loom_migrations` tracking table, applies pending files
// in filename order, records each tag.  Consecutive pending files share
// one transaction; a file marked `-- loom:no-transaction` (a generation's
// `CREATE INDEX CONCURRENTLY` unit) runs alone on an autocommit
// connection.  Out of band: `python -m app.db.migrate`.
// ---------------------------------------------------------------------------

const STATEMENT_BREAKPOINT = "--> statement-breakpoint";

/** Same module-qualified tag the Hono emitter uses — every module's first
 *  generation is named "Initial", and the module keeps the filename saying
 *  which one it is. */
function migrationTag(version: string, module: string, name: string): string {
  return `${version}_${snake(module)}_${snake(name)}`;
}

export function emitPythonMigrations(migrations: MigrationsIR[], out: Map<string, string>): void {
  const render = (steps: readonly MigrationStep[]): string =>
    steps.flatMap((s) => splitPgStatements(renderPgStep(s))).join(`\n${STATEMENT_BREAKPOINT}\n`);
  for (const m of migrations) {
    if (m.steps.length === 0) continue;
    const tag = migrationTag(m.version, m.module, m.name);
    const { transactional, nonTransactional } = splitTransactionalSteps(m.steps);
    if (transactional.length > 0) out.set(`migrations/${tag}.sql`, `${render(transactional)}\n`);
    // The non-transactional unit (`CREATE INDEX CONCURRENTLY`): `<tag>_concurrent`
    // sorts right after `<tag>`, and the marker line tells `run_migrations` to
    // apply it on an autocommit connection.
    if (nonTransactional.length > 0) {
      out.set(
        `migrations/${tag}_concurrent.sql`,
        `${NO_TRANSACTION_MARKER}\n${render(nonTransactional)}\n`,
      );
    }
  }
}

export const MIGRATE_PY = `"""Boot-time migration runner.  Auto-generated.

Applies pending SQL files from migrations/ in filename order, tracking
applied tags in __loom_migrations (the Drizzle-runtime-migrator
pattern).  Out of band: \`python -m app.db.migrate\`.
"""

import asyncio
import time
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.exc import InterfaceError, OperationalError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

from app.db.engine import engine
from app.obs.log import log

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent.parent / "migrations"

_BREAKPOINT = "--> statement-breakpoint"

# Boot-time DB-connect retry (the cross-backend BOOT_DB_RETRY policy): a
# database that is not reachable YET — connection refused, DNS not resolvable,
# "the database system is starting up" — is retried with capped exponential
# backoff before the migration run, so a late db no longer kills the container
# on first boot.  A migration whose SQL fails is never retried.
_DB_CONNECT_MAX_ATTEMPTS = ${BOOT_DB_RETRY.maxAttempts}
_DB_CONNECT_BASE_DELAY_MS = ${BOOT_DB_RETRY.baseDelayMs}
_DB_CONNECT_MAX_DELAY_MS = ${BOOT_DB_RETRY.maxDelayMs}


async def wait_for_db(target: AsyncEngine = engine) -> None:
    attempt = 1
    while True:
        try:
            async with target.connect() as conn:
                await conn.execute(text("SELECT 1"))
            return
        except (OSError, OperationalError, InterfaceError) as exc:
            if attempt >= _DB_CONNECT_MAX_ATTEMPTS:
                raise
            delay_ms = min(_DB_CONNECT_BASE_DELAY_MS * 2 ** (attempt - 1), _DB_CONNECT_MAX_DELAY_MS)
            log(
                "warn",
                "db_connect_retry",
                attempt=attempt,
                max_attempts=_DB_CONNECT_MAX_ATTEMPTS,
                delay_ms=delay_ms,
                error=str(exc),
            )
            await asyncio.sleep(delay_ms / 1000)
            attempt += 1


# First line of a file that must run outside a transaction: a generation's
# CREATE INDEX CONCURRENTLY unit, which Postgres refuses inside a transaction
# block.  Its statements are written to be re-runnable, so a failed file is
# simply retried whole on the next boot.
_NO_TRANSACTION = "${NO_TRANSACTION_MARKER}"


def _in_transaction(sql: str) -> bool:
    return not sql.lstrip().startswith(_NO_TRANSACTION)


async def _apply(conn: AsyncConnection, tag: str, sql: str) -> None:
    started = time.monotonic()
    try:
        for statement in sql.split(_BREAKPOINT):
            stmt = "\\n".join(
                line for line in statement.strip().splitlines() if line.strip() != _NO_TRANSACTION
            ).strip()
            if stmt:
                await conn.execute(text(stmt))
        await conn.execute(text("INSERT INTO __loom_migrations (tag) VALUES (:tag)"), {"tag": tag})
    except Exception as exc:  # noqa: BLE001 — log + re-raise to abort boot
        log("error", "migration_failed", id=tag, name=tag, error=str(exc))
        raise
    log(
        "info",
        "migration_applied",
        id=tag,
        name=tag,
        duration_ms=round((time.monotonic() - started) * 1000, 3),
    )


async def run_migrations(target: AsyncEngine = engine) -> None:
    files = sorted(MIGRATIONS_DIR.glob("*.sql")) if MIGRATIONS_DIR.is_dir() else []
    if not files:
        return
    await wait_for_db(target)
    async with target.begin() as conn:
        await conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS __loom_migrations ("
                "tag TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            )
        )
        rows = (await conn.execute(text("SELECT tag FROM __loom_migrations"))).all()
    applied = {row[0] for row in rows}
    pending = [(f.stem, f.read_text()) for f in files if f.stem not in applied]
    # Catalog migration-lifecycle events (observability.md) — same
    # event names + level Hono/.NET emit so a cross-backend log
    # consumer pivots on one identity.
    log("info", "migrations_starting", count=len(pending))
    count = 0
    while count < len(pending):
        tag, sql = pending[count]
        if not _in_transaction(sql):
            async with target.connect() as raw:
                conn = await raw.execution_options(isolation_level="AUTOCOMMIT")
                await _apply(conn, tag, sql)
            count += 1
            continue
        # Consecutive transactional files share one transaction.
        end = count
        while end < len(pending) and _in_transaction(pending[end][1]):
            end += 1
        async with target.begin() as conn:
            for batch_tag, batch_sql in pending[count:end]:
                await _apply(conn, batch_tag, batch_sql)
        count = end
    log("info", "migrations_complete", applied=count)


if __name__ == "__main__":
    asyncio.run(run_migrations())
`;
