// The `timer` family of the diagnostic-message catalog: the `loom.timer-*`
// codes, raised by `src/language/validators/timer.ts` and
// `src/ir/validate/checks/timer-checks.ts`.  `../messages.ts` merges every
// family into `DIAGNOSTIC_MESSAGES`, and `test/system/diagnostic-catalog.test.ts`
// fails on a key filed under the wrong family.

import type { MessageEntry } from "./_shared.js";

/** The code first-segments this family owns. */
export const segments = ["timer"] as const;

export const messages = {
  "loom.timer-cadence#both-cron-and-every": (p: { name: unknown }) =>
    `timerSource '${p.name}' sets both 'cron:' and 'every:' — set exactly one.`,
  "loom.timer-cadence#neither-cron-nor-every": (p: { name: unknown }) =>
    `timerSource '${p.name}' sets neither 'cron:' nor 'every:' — a cadence is required.`,
  "loom.timer-cadence#cron-malformed": (p: { name: unknown; err: unknown }) =>
    `cron on timerSource '${p.name}' is invalid: ${p.err}.`,
  "loom.timer-cadence#every-malformed": (p: { name: unknown }) =>
    `'every:' on timerSource '${p.name}' is not a valid duration (e.g. 15s, 90m).`,
  "loom.timer-cadence#every-below-floor": (p: { name: unknown; minIntervalMs: unknown }) =>
    `'every:' on timerSource '${p.name}' is below the ${p.minIntervalMs}ms floor — timers may not fire more often than once per second.`,
  "loom.timer-cadence#every-cron-expressible": (p: { name: unknown; cronEquiv: unknown }) =>
    `'every:' on timerSource '${p.name}' is cleanly cron-expressible — write 'cron: "${p.cronEquiv}"'. 'every:' is only for intervals cron cannot express (sub-minute, or non-dividing like 7m/90m).`,
  "loom.timer-tenant-read": (p: {
    reactor: unknown;
    timer: unknown;
    agg: unknown;
    read: unknown;
  }) =>
    `reactor '${p.reactor}' runs on timer '${p.timer}', which has no tenant, but reads the ` +
    `tenant-owned aggregate '${p.agg}' through \`${p.read}\`.  The read's tenant filter would match ` +
    `nothing.  Make the cross-tenant read explicit: widen the read with \`ignoring tenantOwned\` ` +
    `(\`Repo.all(C) ignoring tenantOwned\`, \`Repo.getBy(…) ignoring tenantOwned\`).`,
  "loom.timer-event-shape#not-infrastructure-only": (p: {
    name: unknown;
    event: unknown;
    ctxName: unknown;
  }) =>
    `timerSource '${p.name}' fires '${p.event}', which is already emitted by domain logic in context '${p.ctxName}'. A timer's 'for:' event must be infrastructure-emitted only — declare a dedicated tick event (e.g. 'event ${p.event}Tick { at: datetime }').`,
  "loom.timer-event-shape#no-at-field": (p: { event: unknown; name: unknown }) =>
    `tick event '${p.event}' (fired by timerSource '${p.name}') has no 'at: datetime' field; the reacting workflow body cannot read the fire time.`,
  "loom.timer-needs-state#owner-binds-no-state": (p: { name: unknown; owner: unknown }) =>
    `timerSource '${p.name}' is owned by deployable '${p.owner}', whose platform binds no relational state. Single-fire delivery needs a Postgres advisory lock — host the context on a database-backed backend.`,
  "loom.timer-needs-state#context-has-no-db-owner": (p: { name: unknown; context: unknown }) =>
    `timerSource '${p.name}' fires an event in context '${p.context}', which no database-backed deployable owns. Single-fire delivery needs a Postgres advisory lock — host the context on a backend that binds a relational 'state' resource.`,
  "loom.timer-source-unbound": (p: { name: unknown; event: unknown }) =>
    `timerSource '${p.name}' fires '${p.event}', but no workflow reacts to it ('on(_: ${p.event})' / 'create(_: ${p.event}) by …'). The timer will run and emit into the void.`,
  "loom.timer-source-unbound#unreachable": (p: {
    name: unknown;
    event: unknown;
    owner: unknown;
    consumers: unknown;
  }) =>
    `timerSource '${p.name}' runs on deployable '${p.owner}', but every workflow that reacts to '${p.event}' is hosted on another deployable (${p.consumers}) and no channel carries '${p.event}'. The tick is dispatched in-process only and never reaches them — declare a channel carrying '${p.event}' and bind it with a channelSource on both deployables.`,
} satisfies Record<string, MessageEntry>;
