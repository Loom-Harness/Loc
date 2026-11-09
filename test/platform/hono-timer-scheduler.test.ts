// timerSource → Hono scheduler emission (scheduling.md, M-T4.1 + Phase 2 durable).
//
// Pins the durable-driver shape at the lowest catching altitude: pure in-memory
// `generateSystems` (no docker, no LOOM_* env). Asserts that `cron:` timers run
// on pg-boss (durable, retried, single-fire + the coalesce-once catch-up over the
// `loom_timer_runs` watermark), `every:` timers stay in-process (setInterval +
// tx-scoped advisory lock), the async boot wiring, the pg-boss/cron-parser deps
// (node-cron is gone) — and that a timer-free deployable is byte-identical.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const WITH_TIMERS = `
system Reaping {
  subdomain Ops {
    context Orders {
      aggregate Sweep { runId: string }
      event SweepTick { sweep: Sweep id, at: datetime }
      event SweepRan  { sweep: Sweep id, at: datetime }
      event HealthTick { at: datetime }
      channel Ticks { carries: SweepTick }
      workflow SweepRun eventSourced {
        sweep: Sweep id
        firedAt: datetime
        create(t: SweepTick) by t.sweep { emit SweepRan { sweep: t.sweep, at: t.at } }
        apply(r: SweepRan) { firedAt := r.at }
      }
    }
  }
  storage pg { type: postgres }
  resource opsState { for: Orders, kind: state, use: pg }
  api A from Ops
  deployable d { platform: node, contexts: [Orders], dataSources: [opsState], serves: A, port: 4000 }
  timerSource sweep   { for: SweepTick, cron: "*/5 * * * *" }
  timerSource healthz { for: HealthTick, every: 15s }
}
`;

const NO_TIMERS = `
system Plain {
  subdomain Ops { context Orders { aggregate Order { status: string } } }
  storage pg { type: postgres }
  resource opsState { for: Orders, kind: state, use: pg }
  api A from Ops
  deployable d { platform: node, contexts: [Orders], dataSources: [opsState], serves: A, port: 4000 }
}
`;

describe("timerSource → Hono durable scheduler", () => {
  it("runs cron: on pg-boss (durable + retry + catch-up) and every: in-process", async () => {
    const files = await generateSystemFiles(WITH_TIMERS);
    const get = (suffix: string): string =>
      [...files.entries()].find(([k]) => k.endsWith(suffix))?.[1] ?? "";

    const scheduler = get("d/scheduler.ts");
    expect(scheduler).not.toBe("");

    // cron: → pg-boss (v12 named export), durable + single-fire + retry.
    expect(scheduler).toContain('import { PgBoss } from "pg-boss"');
    expect(scheduler).toContain('import { CronExpressionParser } from "cron-parser"');
    expect(scheduler).toContain(
      'await boss.schedule(queue, "*/5 * * * *", {}, { retryLimit: 3, retryBackoff: true })',
    );
    expect(scheduler).toContain("await boss.work(queue");
    // Coalesce-once catch-up over the self-owned watermark table.
    expect(scheduler).toContain("CREATE TABLE IF NOT EXISTS loom_timer_runs");
    expect(scheduler).toContain('event: "timer_catchup"');
    expect(scheduler).toContain("await boss.send(queue, {}, { singletonKey: prev.toISOString() })");
    // First boot must not retro-fire — baseline insert on a missing watermark.
    expect(scheduler).toContain("ON CONFLICT (timer) DO NOTHING");
    // node-postgres returns timestamptz as a string — coercion guard.
    expect(scheduler).toContain("new Date(raw)");

    // every: → in-process setInterval + tx-scoped advisory lock (single-fire).
    expect(scheduler).toContain("setInterval(() => void tick(), 15000)");
    expect(scheduler).toContain("pg_try_advisory_xact_lock");
    expect(scheduler).toContain("function timerLockKey");

    // The tick struct: mint an id per tick, stamp the fire time.
    expect(scheduler).toContain("Ids.newSweepId()");
    expect(scheduler).toContain("at: new Date()");

    // node-cron is gone entirely.
    expect(scheduler).not.toContain("node-cron");
  });

  it("wires the durable scheduler at boot (async) and swaps node-cron for pg-boss deps", async () => {
    const files = await generateSystemFiles(WITH_TIMERS);
    const get = (suffix: string): string =>
      [...files.entries()].find(([k]) => k.endsWith(suffix))?.[1] ?? "";

    const boot = get("d/boot.ts");
    expect(boot).toContain('import { startTimerScheduler } from "./scheduler"');
    // Async start + async disposer (pg-boss boot/stop are async).  The host's
    // `infra` choice rides through: the playground runs cron in-process.
    expect(boot).toContain(
      "const stopTimers = await startTimerScheduler(db, inProcessEvents, { infra: opts.infra });",
    );
    expect(boot).toContain("await stopTimers();");
    expect(get("d/index.ts")).not.toContain("scheduler");

    // `infra: "in-process"` (the browser playground, whose PGlite pg-boss
    // cannot connect to) swaps pg-boss for the in-memory cron stand-in and
    // fires every: ticks without the advisory-lock transaction.
    const scheduler = get("d/scheduler.ts");
    expect(scheduler).toContain(
      'opts.infra === "in-process"\n      ? createInProcessCronBoss()\n      : new PgBoss(',
    );
    expect(scheduler).toContain('baseLogger.warn({ event: "timer_cron_in_process" });');
    expect(scheduler).toMatch(
      /if \(opts\.infra === "in-process"\) \{\n\s+await events\.dispatch\(build\(\)\);/,
    );

    const pkg = get("d/package.json");
    expect(pkg).toContain("pg-boss");
    expect(pkg).toContain("cron-parser");
    expect(pkg).not.toContain("node-cron");
  });

  it("is byte-identical for a timer-free deployable (no scheduler artifacts)", async () => {
    const files = await generateSystemFiles(NO_TIMERS);
    const keys = [...files.keys()];
    expect(keys.some((k) => k.endsWith("d/scheduler.ts"))).toBe(false);

    const get = (suffix: string): string =>
      [...files.entries()].find(([k]) => k.endsWith(suffix))?.[1] ?? "";
    expect(get("d/package.json")).not.toContain("pg-boss");
    const boot = get("d/boot.ts");
    expect(boot).not.toContain("startTimerScheduler");
    expect(boot).not.toContain("scheduler");
    // The plain boot path — no shared dispatcher construction.
    expect(boot).toContain("const app = createApp(db);");
  });

  // A tick whose channel the timer's deployable binds to a broker must ride
  // the publish tee: its only consumer lives on another deployable, behind the
  // broker, and an in-process dispatch never reaches it.
  it("publishes a broker-bound tick through the channel tee", async () => {
    const src = `
system T {
  subdomain Up { context Clock {
    aggregate Run with crudish { label: string }
    repository Runs for Run { }
    event Tick { run: Run id, at: datetime }
    channel Ticks { carries: Tick } } }
  subdomain Down { context Billing {
    aggregate Cut with crudish { at: datetime }
    repository Cuts for Cut { }
    workflow OnTick { run: Run id  create(t: Tick) by t.run { let c = Cut.create(at: t.at) } } } }
  storage pg { type: postgres }
  storage bus { type: redis }
  resource clockState { for: Clock, kind: state, use: pg }
  resource billState { for: Billing, kind: state, use: pg }
  timerSource t { for: Tick, every: 30s }
  channelSource tb { for: Ticks, use: bus }
  deployable up { platform: node contexts: [Clock] dataSources: [clockState] channels: [tb] port: 3000 }
  deployable down { platform: node contexts: [Billing] dataSources: [billState] channels: [tb] port: 3001 }
}`;
    const files = await generateSystemFiles(src);
    const boot = files.get("up/boot.ts") ?? "";
    expect(boot).toContain(
      "const stopTimers = await startTimerScheduler(db, channelPublishTee(channelTransports, inProcessEvents), { infra: opts.infra });",
    );
    // `up` hosts no reactor, so `http/workflows.ts` exports no in-process
    // dispatcher: boot must not import one, it takes the Noop.
    expect(boot).not.toContain("createInProcessDispatcher");
    expect(boot).toContain("const inProcessEvents = realtimeTee(NoopDomainEventDispatcher);");
  });
});
