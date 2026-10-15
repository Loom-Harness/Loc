// Auto-generated — durable timer scheduler (scheduling.md).
// cron: → pg-boss (durable, retried, single-fire); every: → in-process.
// Emitted only when this deployable owns timerSources.
import { PgBoss } from "pg-boss";
import { CronExpressionParser } from "cron-parser";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as Ids from "./domain/ids";
import type * as Events from "./domain/events";
import type { DomainEventDispatcher } from "./domain/events";
import type * as schema from "./db/schema";
import { baseLogger } from "./obs/log";

// Starts every owned timer.  Async: pg-boss boot is async, and the returned
// disposer awaits a clean pg-boss shutdown.
export async function startTimerScheduler(
  db: NodePgDatabase<typeof schema>,
  events: DomainEventDispatcher,
): Promise<() => Promise<void>> {
  const disposers: Array<() => void | Promise<void>> = [];

  // ── cron timers: pg-boss (durable, retried, single-fire across replicas) ──
  const boss = new PgBoss({ connectionString: process.env.DATABASE_URL });
  boss.on("error", (err) =>
    baseLogger.error({ event: "timer_emit_failed", timer: "(pg-boss)",
      error: err instanceof Error ? err.message : String(err) }),
  );
  await boss.start();
  // Watermark for the coalesce-once catch-up (pg-boss has no missed-window
  // back-fill).  Self-owned — created here like pg-boss creates its own
  // schema, so it never enters the domain MigrationsIR.
  await db.execute(
    sql`CREATE TABLE IF NOT EXISTS loom_timer_runs (timer text PRIMARY KEY, last_fired_at timestamptz NOT NULL DEFAULT now())`,
  );
  disposers.push(async () => {
    await boss.stop();
  });

  // timerSource monthEnd { for: MonthEnd, cron: 0 2 1 * * } — durable (pg-boss)
  {
    const queue = "timer_monthEnd";
    await boss.createQueue(queue);
    await boss.work(queue, async () => {
      await events.dispatch({ type: "MonthEnd", run: Ids.newInterestRunId(), at: new Date() });
      await db.execute(
        sql`INSERT INTO loom_timer_runs (timer, last_fired_at) VALUES (${queue}, now()) ON CONFLICT (timer) DO UPDATE SET last_fired_at = now()`,
      );
      baseLogger.info({ event: "timer_fired", timer: "monthEnd" });
    });
    // Durable schedule: single-fire across replicas + retry with backoff.
    await boss.schedule(queue, "0 2 1 * *", {}, { retryLimit: 3, retryBackoff: true });
    // Coalesce-once catch-up: pg-boss does not back-fill a boundary missed
    // while every replica was down.  On the FIRST boot (no watermark) we
    // establish a baseline WITHOUT retro-firing — a fresh deploy must not
    // replay historical boundaries.  On a later boot, if the previous
    // boundary is > 60s old (outside pg-boss's own send window, so no
    // double-fire) and later than the last recorded run, replay it once.
    {
      const prev = CronExpressionParser.parse("0 2 1 * *", { currentDate: new Date() }).prev().toDate();
      const ageSec = (Date.now() - prev.getTime()) / 1000;
      const seen = await db.execute(sql`SELECT last_fired_at FROM loom_timer_runs WHERE timer = ${queue}`);
      // node-postgres returns timestamptz as a string — coerce before compare.
      const raw = (seen.rows[0] as { last_fired_at: string | Date } | undefined)?.last_fired_at;
      const last = raw != null ? new Date(raw) : undefined;
      if (!last) {
        await db.execute(
          sql`INSERT INTO loom_timer_runs (timer, last_fired_at) VALUES (${queue}, now()) ON CONFLICT (timer) DO NOTHING`,
        );
      } else if (ageSec >= 60 && last.getTime() < prev.getTime()) {
        await boss.send(queue, {}, { singletonKey: prev.toISOString() });
        baseLogger.info({ event: "timer_catchup", timer: "monthEnd", boundary: prev.toISOString() });
      }
    }
  }

  return async () => {
    for (const dispose of disposers) await dispose();
  };
}