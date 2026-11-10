// Shared channel-transport vocabulary (channels.md, M-T4.4).
//
// Single source of truth for the delivery×retention → storage-type
// compatibility matrix, the set of storage types that have (or will have) a
// broker driver, and the derived broker naming scheme.  Lives in `src/util/`
// because both the language validator (`validators/channel.ts`) and the
// generator/system layers consume it — the same layering rationale as
// pack-identity metadata (CLAUDE.md §Architecture).
//
// Pinned decision (M-T4.4 design §2, 2026-07-18): the broker line-up is
// redis → rabbitmq → kafka; **NATS is not a channel transport** (it stays a
// parseable storage type for other roles and is rejected by
// `loom.channelsource-transport-invalid`).

/** Storage types that are (or are slated to become) channel transports.
 *  `inMemory` is the degenerate in-process transport — compatible only with
 *  the profile the in-process dispatcher already realises. */
export const CHANNEL_TRANSPORT_TYPES: ReadonlySet<string> = new Set([
  "inMemory",
  "redis",
  "rabbitmq",
  "kafka",
]);

/** delivery×retention → the storage types that can realise it.
 *  Mirrors the post-NATS matrix in M-T4.4 design §2 / channels.md
 *  §"Transport compatibility matrix". */
export const CHANNEL_COMPATIBILITY: Record<string, ReadonlySet<string>> = {
  "broadcast/ephemeral": new Set(["inMemory", "redis"]),
  "broadcast/log": new Set(["kafka"]),
  "queue/ephemeral": new Set(["redis", "rabbitmq"]),
  "queue/work": new Set(["rabbitmq", "kafka"]),
};

/** delivery/retention combos each SHIPPED broker driver actually realises,
 *  keyed by broker transport → set of `"<delivery>/<retention>"`.  Narrower
 *  than `CHANNEL_COMPATIBILITY` on purpose: the matrix says what a storage type
 *  COULD realise; this says what the shipped drivers DO realise (redis streams
 *  for `queue/ephemeral`-on-redis and the extra kafka combos are later slices).
 *
 *  Lives here (not in `src/generator/_channels/`) so the language validator can
 *  gate a compatible-but-not-yet-shipped binding
 *  (`loom.channelsource-not-yet-shipped`) without importing downward into the
 *  generator layer.  The generator's binding resolver imports it too, so the
 *  validator's gate and the emitter's silent-skip stay driven by ONE list. */
export const SHIPPED_COMBOS: Record<string, ReadonlySet<string>> = {
  redis: new Set(["broadcast/ephemeral"]),
  rabbitmq: new Set(["queue/ephemeral", "queue/work"]),
  // Kafka: the log — per-partition ordering keyed by `loomkey` ??
  // envelope id; one consumer group per deployable (a `broadcast` deployable's
  // group sees every record, `queue` replicas compete within their group).
  kafka: new Set(["broadcast/log", "queue/work"]),
};

/** The broker address of a channel — dot-hierarchical, deliberately leaving
 *  suffix room for the realtime room segments (M-T1.10):
 *  `loom.<context>.<channel>`. */
export function channelAddress(contextName: string, channelName: string): string {
  return `loom.${contextName}.${channelName}`;
}

/** The consumer-group name a deployable's replicas share on a channel:
 *  `<address>.<deployable>`.  Replicas of one deployable compete within the
 *  group (`queue`); distinct deployables get distinct groups (`broadcast`
 *  fan-out across deployables). */
export function consumerGroup(address: string, deployableName: string): string {
  return `${address}.${deployableName}`;
}

/** The per-binding env var carrying the broker URL into a wired deployable:
 *  `LOOM_CHANNEL_<NAME>_URL` (name upper-snaked). */
export function channelSourceEnvVar(channelSourceName: string): string {
  const snake = channelSourceName
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toUpperCase();
  return `LOOM_CHANNEL_${snake}_URL`;
}

/** The CloudEvents 1.0 envelope attribute set every broker-published Loom
 *  event carries (M-T4.4 design §3).  Pinned here (and by the conformance
 *  test) so every backend's envelope builder/parser derives from one list —
 *  a Hono producer's envelope must parse in a Python consumer byte-for-byte.
 *
 *  `data` is the event's existing wire-shape JSON; `id` is the outbox row id
 *  and doubles as the consumer-side idempotency key. */
export const LOOM_ENVELOPE_REQUIRED = [
  "specversion", // literal "1.0"
  "id",
  "type", // `<Context>.<EventName>`
  "source", // `/loom/<deployable>/<context>`
  "time",
  "datacontenttype", // literal "application/json"
  "loomchannel", // `<Context>.<Channel>`
  "data",
] as const;

export const LOOM_ENVELOPE_OPTIONAL = [
  "loomkey", // value of the channel's `key:` field, if declared
  "correlationid",
  "scopeid",
  "tenantid", // the triggering event's tenant — the consumer's reactor runs as
  // the system principal OF this tenant (ruling D1); never a user grant
  "loomcausedby", // the originating user id — audit and logs only
] as const;

/** The reserved key a durable event's outbox row payload carries its EVENT
 *  ORIGIN under (ruling D1, D-REACTOR-SYSTEM-PRINCIPAL): `{ tenant, causedBy }`,
 *  snapshotted from the raising principal at capture time, so the relay —
 *  which runs long after the request is gone — can open the reactor's frame as
 *  the system principal of that tenant and stamp the same two attributes onto
 *  the broker envelope.  Lives inside the JSON payload
 *  (no outbox schema change); every backend strips it before decoding. */
export const LOOM_OUTBOX_ORIGIN_KEY = "__loomOrigin";

/** The `__loom_outbox` rows a relay still owes delivery: neither dispatched
 *  nor dead-lettered.  Every backend's poll filters on exactly this, and the
 *  shared migration's partial index `__loom_outbox_pending_idx` carries it as
 *  its predicate, so the poll stays an index range read however much history
 *  the table holds. */
export const OUTBOX_PENDING_PREDICATE = "dispatched_at IS NULL AND dead_at IS NULL";

/** Outbox retention: every relay deletes DISPATCHED rows older than this many
 *  days (env `LOOM_OUTBOX_RETENTION_DAYS`; a missing, non-numeric or
 *  non-positive value falls back to the default).  Dead-lettered rows are
 *  never purged — they wait for an operator's replay or delete. */
export const OUTBOX_RETENTION_ENV = "LOOM_OUTBOX_RETENTION_DAYS";
export const OUTBOX_RETENTION_DEFAULT_DAYS = 7;

/** How often (seconds) a relay runs its retention purge — a few minutes, not
 *  every poll tick. */
export const OUTBOX_PURGE_INTERVAL_SECONDS = 300;

/** The most dispatched rows one purge pass deletes, on the backends whose
 *  store can bound a DELETE (raw SQL / a LIMITed id subquery); the rest
 *  delete every expired row in one statement. */
export const OUTBOX_PURGE_BATCH = 1000;
