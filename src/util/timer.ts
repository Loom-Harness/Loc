/**
 * Timer cadence helpers (scheduling.md, M-T4.1) — shared by the lowering pass
 * (`lower.ts` normalises `every:` to milliseconds) and the IR validator
 * (`loom.timer-cadence` range-checks cron and enforces the `every:`/`cron:`
 * split).  Lives in `ir/util/` so both the `ir/lower` and `ir/validate` layers
 * can consume it without an upward import.
 */

/** Duration unit → milliseconds. */
const UNIT_MS: Record<string, number> = {
  ms: 1,
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Cadence floor — the shortest interval a `timerSource` may fire at, to keep
 *  claim-row churn sane.  One second (below cron's minute granularity, so
 *  still a legitimate `every:`-only cadence). */
export const MIN_INTERVAL_MS = 1_000;

/** Parse a `DURATION` token (`<int><unit>`, unit ∈ {ms,s,m,h,d}) to milliseconds.
 *  Returns 0 for an unparseable string (the validator reports the real error;
 *  lowering must not throw). */
export function parseDurationMs(literal: string): number {
  const m = /^([0-9]+)(ms|s|m|h|d)$/.exec(literal.trim());
  if (!m) return 0;
  return Number(m[1]) * UNIT_MS[m[2]];
}

/** Cron `@nickname`s every backend's scheduler understands. */
const CRON_NICKNAMES = new Set([
  "@yearly",
  "@annually",
  "@monthly",
  "@weekly",
  "@daily",
  "@hourly",
]);

/** Inclusive numeric bounds for each of the 5 cron fields, in order. */
const CRON_FIELD_BOUNDS: ReadonlyArray<{ name: string; min: number; max: number }> = [
  { name: "minute", min: 0, max: 59 },
  { name: "hour", min: 0, max: 23 },
  { name: "day-of-month", min: 1, max: 31 },
  { name: "month", min: 1, max: 12 },
  { name: "day-of-week", min: 0, max: 7 },
];

/** Validate a single cron field value (a star, a step, a range, a number, or
 *  comma lists of those) against its numeric bounds.  Returns an error or null. */
function checkCronField(
  raw: string,
  bound: { name: string; min: number; max: number },
): string | null {
  for (const part of raw.split(",")) {
    let body = part;
    if (body.includes("/")) {
      const [range, step] = body.split("/");
      if (!/^[0-9]+$/.test(step)) return `${bound.name} step "/${step}" must be a positive integer`;
      body = range;
    }
    if (body === "*") continue;
    if (body.includes("-")) {
      const [lo, hi] = body.split("-");
      if (!/^[0-9]+$/.test(lo) || !/^[0-9]+$/.test(hi))
        return `${bound.name} range "${part}" is malformed`;
      if (Number(lo) < bound.min || Number(hi) > bound.max) {
        return `${bound.name} must be ${bound.min}-${bound.max}`;
      }
      continue;
    }
    if (!/^[0-9]+$/.test(body))
      return `${bound.name} value "${part}" is not a number, range, or step`;
    if (Number(body) < bound.min || Number(body) > bound.max) {
      return `${bound.name} must be ${bound.min}-${bound.max}`;
    }
  }
  return null;
}

/** Validate a cron expression (a 5-field expression or an `@nickname`).  Returns
 *  an error string (for `loom.timer-cadence`) or null when it is well-formed. */
export function checkCron(expr: string): string | null {
  const trimmed = expr.trim();
  if (trimmed.startsWith("@")) {
    return CRON_NICKNAMES.has(trimmed)
      ? null
      : `unknown cron nickname "${trimmed}" (use @yearly/@monthly/@weekly/@daily/@hourly or a 5-field expression)`;
  }
  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) {
    return `must be a 5-field expression (minute hour day-of-month month day-of-week) or an @nickname`;
  }
  for (let i = 0; i < 5; i++) {
    const err = checkCronField(fields[i], CRON_FIELD_BOUNDS[i]);
    if (err) return err;
  }
  return null;
}

/** If a fixed interval is cleanly expressible as a portable 5-field cron
 *  expression, return that cron (so the validator can steer `every:` → `cron:`);
 *  otherwise null.  Cron-expressible = a whole number of minutes/hours that
 *  evenly divides its unit (every N minutes with 60 % N == 0, every N hours with
 *  24 % N == 0), plus the exact daily boundary.  Sub-minute and non-dividing
 *  intervals (7m, 90m, 15s) are NOT cron-expressible — the whole point of
 *  `every:`. */
export function cronEquivalentOf(everyMs: number): string | null {
  if (everyMs <= 0 || everyMs % 60_000 !== 0) return null; // sub-minute → every: only
  const minutes = everyMs / 60_000;
  if (minutes < 60) return 60 % minutes === 0 ? `*/${minutes} * * * *` : null;
  if (minutes % 60 !== 0) return null; // non-dividing (e.g. 90m) → every: only
  const hours = minutes / 60;
  if (hours < 24) return 24 % hours === 0 ? `0 */${hours} * * *` : null;
  if (hours === 24) return `0 0 * * *`;
  return null;
}

/** The single-fire ledger for `every:` timers: one row per timer holding the
 *  last period it fired in.  A companion table in the shared `MigrationsIR`
 *  (`timerClaimTableShape` in `system/migrations-builder.ts`), so every backend
 *  creates it from one shape. */
export const TIMER_CLAIM_TABLE = "__loom_timer";

/** How often a replica polls the claim for an `every:` timer: twice per period.
 *  Any window of one period then holds at least one poll from every live
 *  replica, so no period is skipped while one replica runs, and the claim — not
 *  the poll rate — bounds the fire count to one per period. */
export function timerPollMs(everyMs: number): number {
  return Math.max(1, Math.floor(everyMs / 2));
}

/** The one statement that claims the current period of an `every:` timer.
 *
 *  The period is `floor(epoch_ms / everyMs)` read off the DATABASE clock
 *  (`clock_timestamp()`), so replicas whose own clocks disagree still compute
 *  the same period.  The upsert moves `last_period` forward only when it is
 *  behind, and returns a row only to the caller whose statement moved it: a
 *  replica that gets a row fires, every other replica polling the same period
 *  gets none and skips.  It is a single autocommitted statement — no
 *  transaction is held across the dispatch, so a host with one database
 *  connection (the playground's PGlite) can run the tick's own writes after it.
 *
 *  A claimed period is spent before the tick dispatches: a replica that dies
 *  between the claim and the dispatch loses that period's fire, and the next
 *  period fires normally.  Periods during which no replica polled are skipped,
 *  not replayed — the claim always jumps to the current period.
 *
 *  Name and period are compile-time constants inlined as literals, so every
 *  backend runs the same text with no driver-specific parameter binding.
 *  Contains no `"`, `\``, `$` or `#{`, so it embeds verbatim in a C#, Java,
 *  Python, Elixir or TypeScript string. */
export function timerClaimSql(name: string, everyMs: number): string {
  const nameLit = `'${name.replace(/'/g, "''")}'`;
  const period = `floor(extract(epoch from clock_timestamp()) * 1000 / ${everyMs})::bigint`;
  return (
    `INSERT INTO ${TIMER_CLAIM_TABLE} AS t (timer, last_period, fired_at) ` +
    `VALUES (${nameLit}, ${period}, clock_timestamp()) ` +
    "ON CONFLICT (timer) DO UPDATE SET last_period = EXCLUDED.last_period, fired_at = clock_timestamp() " +
    "WHERE t.last_period < EXCLUDED.last_period RETURNING t.last_period"
  );
}
