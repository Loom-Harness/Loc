// Timer scheduler emission (scheduling.md, M-T4.1) — the Python /
// FastAPI half.
//
// A `timerSource` fires a plain domain event on a wall-clock cadence.  The
// firing contract splits by cadence:
//
//   * `cron:` timers are DURABLE — driven by procrastinate, a Postgres-native
//     async job store.  Each becomes an `@app.periodic(cron=…)` task whose
//     single-fire (one job per boundary across every replica) and missed-run
//     catch-up (coalesce-once replay of a boundary missed while every replica
//     was down) are STORE-COORDINATED by procrastinate's `periodic_defers`
//     table — no advisory lock, no per-replica bookkeeping.  Retries ride on
//     procrastinate's `RetryStrategy`.
//   * `every:` (sub-minute) timers stay IN-PROCESS — an asyncio loop polling at
//     half the period, each poll claiming the current period's `__loom_timer`
//     row (`timerClaimSql`, decision D-TIMER-SINGLE-FIRE; the same statement
//     every backend runs), so one replica fires per period.  procrastinate's
//     cron is minute-granular, so sub-minute cadences can't be durable jobs.
//
// Both paths build the tick event struct and dispatch it through the SAME
// in-process dispatcher the sagas already route through — so an `on(t: Tick)` /
// `create(t: Tick) by …` reactor fires with no new dispatch machinery.
//
// Emitted ONLY when the deployable owns at least one timerSource; a timer-free
// deployable is byte-identical to before (no scheduling.py, no procrastinate
// dep, no lifespan wiring).  A `cron:`-free (every-only) deployable pulls no
// procrastinate dep either — it rides the existing sqlalchemy/asyncpg session.

import type { EventIR, FieldIR, TimerSourceIR } from "../../ir/types/loom-ir.js";
import { lines } from "../../util/code-builder.js";
import { pythonIdent, snake } from "../../util/naming.js";
import { timerClaimSql, timerPollMs } from "../../util/timer.js";
import { pyModule, pyRef } from "../_imports/python.js";
import { ref } from "../_imports/symbol.js";
import { PY, pyNewId } from "./py-symbols.js";

const PROCRASTINATE = ref(pyModule("procrastinate"));

/** Does any owned timer use a real cron expression (vs a bare-interval
 *  `every:`)?  Gates the procrastinate dependency + the durable job store — a
 *  `every:`-only deployable needs neither. */
export function anyPyTimerUsesCron(timers: readonly TimerSourceIR[]): boolean {
  return timers.some((ts) => ts.cadence.kind === "cron");
}

/** The `cron:` timers — durable procrastinate periodic tasks. */
function cronTimers(timers: readonly TimerSourceIR[]): TimerSourceIR[] {
  return timers.filter((ts) => ts.cadence.kind === "cron");
}

/** The `every:` timers — in-process asyncio poll loops + the period claim. */
function everyTimers(timers: readonly TimerSourceIR[]): TimerSourceIR[] {
  return timers.filter((ts) => ts.cadence.kind === "every");
}

/** The value expression a scheduler tick uses to fill one tick-event field.  A
 *  tick is infrastructure-emitted, so every field is synthesised: id fields get
 *  a fresh id (a new saga instance per tick — the `create(t) by t.<id>`
 *  semantics), `at`-style datetimes get the fire time, and any other scalar
 *  gets a type-safe zero.  The residual arm (`typeIgnore`) covers exotic field
 *  types (enum / value-object) that a real tick never carries — kept
 *  mypy-clean so the emitted struct always typechecks under `--strict`. */
function tickFieldValue(field: FieldIR): { text: string; typeIgnore?: boolean } {
  const t = field.type;
  if (t.kind === "id") return { text: `${pyNewId(t.targetName)}()` };
  if (t.kind === "optional") return { text: "None" };
  if (t.kind === "array") return { text: "[]" };
  if (t.kind === "primitive") {
    switch (t.name) {
      case "datetime":
        return { text: `${PY.datetime}.now(${PY.UTC})` };
      case "date":
        return { text: `${PY.datetime}.now(${PY.UTC}).date()` };
      case "int":
      case "long":
        return { text: "0" };
      case "decimal":
        return { text: "0.0" };
      case "money":
        return { text: `${PY.Decimal}("0")` };
      case "bool":
        return { text: "False" };
      case "string":
      case "guid":
        return { text: '""' };
      case "json":
        return { text: "{}" };
      case "duration":
        return { text: `${PY.timedelta}()` };
    }
  }
  // enum / value-object / union / etc.: not a meaningful tick field — a
  // placeholder that keeps the emitted struct mypy-clean (ticks carry at/id).
  return { text: "None", typeIgnore: true };
}

/** The keyword-argument call that constructs one tick event, e.g.
 *  `SweepTick(sweep=new_sweep_id(), at=datetime.now(UTC))`. */
function tickBuild(event: EventIR): string {
  const kwargs = event.fields.map((f) => {
    const { text, typeIgnore } = tickFieldValue(f);
    return `${pythonIdent(f.name)}=${text}${typeIgnore ? "  # type: ignore[arg-type]" : ""}`;
  });
  return `${event.name}(${kwargs.join(", ")})`;
}

/** The tick events the owned timers fire (the scheduler module imports them). */
function tickEventNames(timers: readonly TimerSourceIR[]): string[] {
  return [...new Set(timers.map((ts) => ts.event))].sort();
}

/**
 * Render `app/scheduling.py` for a deployable's owned timers.  `eventByName`
 * resolves each timer's `for:` event to its declared field shape (for the tick
 * struct).  `hasDispatch` gates whether the in-process dispatcher exists — a
 * timer whose event nothing reacts to (no carrying channel) dispatches into the
 * no-op default instead of crashing on a missing `app.dispatch` import.
 */
export function renderPyTimerScheduler(
  timers: readonly TimerSourceIR[],
  eventByName: Map<string, EventIR>,
  hasDispatch: boolean,
): string {
  const crons = cronTimers(timers);
  const everies = everyTimers(timers);
  const hasCron = crons.length > 0;
  const hasEvery = everies.length > 0;
  const eventNames = tickEventNames(timers);
  // The dispatcher construction — the in-process router the sagas use when a
  // channel carries a subscribed event, else the no-op default.
  const dispatchExpr = hasDispatch
    ? `${pyRef("app.dispatch", "make_dispatcher")}(session)`
    : `${pyRef("app.domain.events", "NoopDomainEventDispatcher")}()`;

  // ── Durable `cron:` timers: one procrastinate periodic task each ──────────
  // The task body opens its own session (it runs on the procrastinate worker,
  // off the request path), builds the tick, and dispatches.  Single-fire +
  // missed-run catch-up are store-coordinated by procrastinate's periodic
  // deferrer (periodic_defers dedup) — no advisory lock here.
  const cronTasks = crons.flatMap((ts) => {
    const event = eventByName.get(ts.event);
    const build = event ? tickBuild(event) : `${ts.event}()`;
    const cron = ts.cadence.kind === "cron" ? ts.cadence.cron : "";
    const fn = `_timer_${snake(ts.name)}`;
    return [
      "",
      "",
      `@timer_app.periodic(cron=${JSON.stringify(cron)}, periodic_id=${JSON.stringify(ts.name)})`,
      "@timer_app.task(",
      // A queueing lock means a boundary is SKIPPED (not queued) while the
      // previous fire is still running — the overlap-skip semantics.  Retries
      // ride on the store: three attempts with exponential backoff.
      `    queueing_lock=${JSON.stringify(`timer:${ts.name}`)},`,
      `    retry=${pyRef("procrastinate", "RetryStrategy")}(max_attempts=3, exponential_wait=2),`,
      ")",
      `async def ${fn}(timestamp: int) -> None:`,
      `    """Durable tick for timerSource ${ts.name} (cron ${JSON.stringify(cron)}).`,
      "",
      "    Runs on the procrastinate worker: opens its own transaction, builds the",
      "    tick event, and dispatches it through the in-process dispatcher.  `timestamp`",
      `    is the scheduled boundary (procrastinate fills it)."""`,
      "    async with session_factory() as session, session.begin():",
      `        await ${dispatchExpr}.dispatch(${build})`,
      `    log("info", "timer_fired", timer=${JSON.stringify(ts.name)}, boundary=timestamp)`,
    ];
  });

  // ── In-process `every:` timers: asyncio poll loop + period claim ─────
  const everyJobs = everies.flatMap((ts) => {
    const event = eventByName.get(ts.event);
    const build = event ? tickBuild(event) : `${ts.event}()`;
    const everyMs = ts.cadence.kind === "every" ? ts.cadence.everyMs : 0;
    const seconds = timerPollMs(everyMs) / 1000;
    const claimSql = JSON.stringify(timerClaimSql(ts.name, everyMs));
    return [
      `        # timerSource ${ts.name} { for: ${ts.event}, every: ${
        ts.cadence.kind === "every" ? ts.cadence.everyMs : 0
      }ms }`,
      "        self._tasks.append(",
      "            asyncio.create_task(",
      "                _interval_loop(",
      `                    ${JSON.stringify(ts.name)},`,
      `                    ${claimSql},`,
      `                    ${seconds},`,
      `                    lambda: ${build},`,
      "                )",
      "            )",
      "        )",
    ];
  });

  return lines(
    `"""Timer scheduler (scheduling.md).  Auto-generated.`,
    "",
    "Fires each owned `timerSource`'s tick event on a wall-clock cadence.",
    "",
    hasCron ? "`cron:` timers are DURABLE — procrastinate periodic tasks whose single-fire" : null,
    hasCron ? "(one job per boundary across every replica) and missed-run catch-up (one" : null,
    hasCron ? "coalesced replay of a boundary missed while every replica was down) are" : null,
    hasCron ? "store-coordinated by the `periodic_defers` table." : null,
    hasEvery
      ? "`every:` (sub-minute) timers run in-process: an asyncio loop polling at half"
      : null,
    hasEvery ? "the period, each poll claiming the period's `__loom_timer` row (once per" : null,
    hasEvery ? "period across replicas)." : null,
    "Ticks dispatch through the SAME in-process dispatcher the sagas use, so an",
    "`on(t: Tick)` / `create(t: Tick) by …` reactor fires with no new dispatch",
    "machinery.",
    "",
    "Emitted only when this deployable owns a timerSource; a timer-free deployable",
    "has no scheduling module.",
    `"""`,
    "",
    "import asyncio",
    "import contextlib",
    // `Callable` / `DomainEvent` annotate the interval-loop helpers only.
    ...(hasEvery ? ["from collections.abc import Callable"] : []),
    "",
    "from app.db.engine import session_factory",
    `from app.domain.events import ${[...(hasEvery ? ["DomainEvent"] : []), ...eventNames].join(", ")}`,
    "from app.obs.log import log",
    "",
    "",
    ...(hasCron
      ? [
          "# procrastinate speaks libpq (psycopg 3); strip SQLAlchemy's async-driver",
          "# suffix off DATABASE_URL to get a plain conninfo.  The durable job store",
          "# shares the app's Postgres database but owns its own connection pool.",
          `_CONNINFO = ${pyRef("app.settings", "DATABASE_URL")}.replace("+asyncpg", "").replace("+psycopg", "")`,
          "",
          `timer_app = ${PROCRASTINATE}.App(`,
          `    connector=${PROCRASTINATE}.PsycopgConnector(conninfo=_CONNINFO),`,
          ")",
          ...cronTasks,
          "",
        ]
      : []),
    ...(hasEvery
      ? [
          "",
          "async def _tick_once(",
          "    name: str, claim_sql: str, build: Callable[[], DomainEvent]",
          ") -> None:",
          `    """One poll: claim the current period (one autocommitted statement that`,
          "    returns a row only to the poll that advanced it, on any replica), then",
          `    build the event and dispatch it in a transaction of its own."""`,
          "    try:",
          "        async with session_factory() as session:",
          "            async with session.begin():",
          `                result = await session.execute(${pyRef("sqlalchemy", "text")}(claim_sql))`,
          "                claimed = result.first()",
          "            if claimed is None:",
          '                log("debug", "timer_lock_contended", timer=name)',
          "                return",
          "            async with session.begin():",
          `                await ${dispatchExpr}.dispatch(build())`,
          '        log("info", "timer_fired", timer=name)',
          "    except Exception as err:  # noqa: BLE001 — one tick's failure is isolated",
          '        log("error", "timer_emit_failed", timer=name, error=str(err))',
          "",
          "",
          "async def _interval_loop(",
          "    name: str, claim_sql: str, seconds: float, build: Callable[[], DomainEvent]",
          ") -> None:",
          `    """Poll \`name\`'s claim every \`seconds\`.  The in-process \`running\` guard is`,
          "    unnecessary here — each iteration awaits its own tick before sleeping, so",
          `    a slow body just delays the next iteration (it never overlaps itself)."""`,
          "    while True:",
          "        await asyncio.sleep(seconds)",
          "        await _tick_once(name, claim_sql, build)",
          "",
        ]
      : []),
    "",
    "class TimerScheduler:",
    `    """Handle for the running timer machinery${
      hasCron ? " — the procrastinate worker" : ""
    }${hasCron && hasEvery ? " and " : ""}${
      hasEvery ? `${hasCron ? "" : " — "}the asyncio interval loops` : ""
    }.`,
    "    Started once at boot; stopped on drain.",
    `    """`,
    "",
    "    def __init__(self) -> None:",
    "        self._stack = contextlib.AsyncExitStack()",
    "        self._tasks: list[asyncio.Task[None]] = []",
    "",
    "    async def start(self) -> None:",
    ...(hasCron
      ? [
          "        # Open the durable store, ensure its schema, and run the worker in",
          "        # process.  The schema DDL is not re-runnable (`CREATE TYPE` fails on a",
          "        # second boot or a second replica), so it is applied only while the jobs",
          "        # table is absent.  `install_signal_handlers=False`: uvicorn owns SIGTERM;",
          '        # `delete_jobs="successful"`: keep the jobs table bounded (the',
          "        # periodic_defers dedup row is what persists, not finished job history).",
          "        await self._stack.enter_async_context(timer_app.open_async())",
          "        present = await timer_app.connector.execute_query_one_async(",
          "            \"SELECT to_regclass('procrastinate_jobs') IS NOT NULL AS present\"",
          "        )",
          '        if not present["present"]:',
          "            await timer_app.schema_manager.apply_schema_async()",
          "        self._tasks.append(",
          "            asyncio.create_task(",
          "                timer_app.run_worker_async(",
          '                    install_signal_handlers=False, delete_jobs="successful"',
          "                )",
          "            )",
          "        )",
        ]
      : []),
    ...everyJobs,
    "",
    "    async def stop(self) -> None:",
    "        for task in self._tasks:",
    "            task.cancel()",
    "        for task in self._tasks:",
    "            with contextlib.suppress(asyncio.CancelledError):",
    "                await task",
    "        await self._stack.aclose()",
    "",
    "",
    "async def start_timer_scheduler() -> TimerScheduler:",
    `    """Start every owned timerSource and return the handle the FastAPI lifespan`,
    `    stops on drain."""`,
    "    scheduler = TimerScheduler()",
    "    await scheduler.start()",
    "    return scheduler",
    "",
  );
}
