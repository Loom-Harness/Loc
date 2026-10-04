"""Boot-time migration runner.  Auto-generated.

Applies pending SQL files from migrations/ in filename order, tracking
applied tags in __loom_migrations (the Drizzle-runtime-migrator
pattern).  Out of band: `python -m app.db.migrate`.
"""

import asyncio
import time
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine

from app.db.engine import engine
from app.obs.log import log

MIGRATIONS_DIR = Path(__file__).resolve().parent.parent.parent / "migrations"

_BREAKPOINT = "--> statement-breakpoint"


async def run_migrations(target: AsyncEngine = engine) -> None:
    files = sorted(MIGRATIONS_DIR.glob("*.sql")) if MIGRATIONS_DIR.is_dir() else []
    if not files:
        return
    async with target.begin() as conn:
        await conn.execute(
            text(
                "CREATE TABLE IF NOT EXISTS __loom_migrations ("
                "tag TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())"
            )
        )
        rows = (await conn.execute(text("SELECT tag FROM __loom_migrations"))).all()
        applied = {row[0] for row in rows}
        pending = [f for f in files if f.stem not in applied]
        # Catalog migration-lifecycle events (observability.md) — same
        # event names + level Hono/.NET emit so a cross-backend log
        # consumer pivots on one identity.
        log("info", "migrations_starting", count=len(pending))
        count = 0
        for f in pending:
            tag = f.stem
            started = time.monotonic()
            try:
                for statement in f.read_text().split(_BREAKPOINT):
                    stmt = statement.strip()
                    if stmt:
                        await conn.execute(text(stmt))
                await conn.execute(
                    text("INSERT INTO __loom_migrations (tag) VALUES (:tag)"), {"tag": tag}
                )
            except Exception as exc:  # noqa: BLE001 — log + re-raise to abort boot
                log("error", "migration_failed", id=tag, name=tag, error=str(exc))
                raise
            count += 1
            log(
                "info",
                "migration_applied",
                id=tag,
                name=tag,
                duration_ms=round((time.monotonic() - started) * 1000, 3),
            )
        log("info", "migrations_complete", applied=count)


if __name__ == "__main__":
    asyncio.run(run_migrations())
