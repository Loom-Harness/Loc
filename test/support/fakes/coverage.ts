// What backs every external service on the behavioural tier, as data: one row
// per registered sourceType × the kind it binds (`src/util/source-types.ts`),
// plus the channel transports and the OIDC issuer.  `coverage.test.ts` keeps it
// complete and honest.
//
// `fake`:
//   real-sidecar     a real, digest-pinned service the kit starts (or CI
//                    provides as a workflow `services:` container)
//   emulated         the emulation core's model (`src/emulation/`), served by
//                    the browser playground only
//   in-process-fake  a transport in the kit over an emulation-core model, for a
//                    service that cannot run (a third-party api, an issuer)
//   n/a              no service to stand in for: the engine itself runs (PGlite,
//                    a file, memory)
//
// A row is either WITNESSED — a behavioural fixture whose golden carries what
// the service observed — or PENDING on an open issue, with a date by which it
// is re-read.  An `unbindable` row is a storage type no kind accepts.

import type { DataSourceKind } from "../../../src/ir/types/loom-ir.js";

export type FakeClass = "real-sidecar" | "emulated" | "in-process-fake" | "n/a";

/** A storage kind, or a non-storage surface the kit also backs. */
export type CoverageKind = DataSourceKind | "channel" | "auth";

export interface CoverageRow {
  sourceType: string;
  kind: CoverageKind;
  fake: FakeClass;
  /** The kit module that starts it (`test/support/fakes/<module>`), when the
   *  kit starts anything. */
  module?: string;
  /** The behavioural fixture that proves it, and the golden `effects` key that
   *  carries its observations — or `"wire"` when the observation is the wire
   *  recording itself (a database read back over the api). */
  witness?: { fixture: string; effects: string };
  /** Not witnessed yet: the open issue that will, and the date the row is
   *  re-read by. */
  pending?: { issue: `#${number}`; reviewUntil: string };
  /** A storage type no kind accepts: nothing to back.  The census fails the
   *  day it gains a kind. */
  unbindable?: true;
  /** The pair is registered but every backend REFUSES it at validate, with
   *  this diagnostic code: an honest gap, so there is nothing to boot.  The
   *  census proves the refusal — a model binding the kind to the type must
   *  draw exactly this code — so the row fails the day a backend starts
   *  accepting the binding (it then needs a witness) or the code changes. */
  refused?: `loom.${string}`;
}

/** The tracking issues a `pending` row may name, while they are open.  DELETE
 *  an entry the day its issue closes: every row still leaning on it then fails,
 *  which is the point — its witness is due.  Checked against GitHub by the
 *  census's online leg (`LOOM_CENSUS_ONLINE=1`). */
export const OPEN_TRACKING_ISSUES: ReadonlySet<string> = new Set([
  "#4440",
  "#5617",
  "#5712",
  "#5846",
]);

/** A pending row may not be parked further out than this. */
export const MAX_PENDING_DAYS = 120;

const REVIEW = "2027-02-15";
const pending = (issue: `#${number}`) => ({ issue, reviewUntil: REVIEW });

export const COVERAGE: readonly CoverageRow[] = [
  // ── relational / event-log engines: the engine runs, no fake ──────────
  {
    sourceType: "postgres",
    kind: "state",
    fake: "n/a",
    witness: { fixture: "core-domain", effects: "wire" },
  },
  { sourceType: "postgres", kind: "snapshot", fake: "n/a", pending: pending("#5617") },
  {
    sourceType: "postgres",
    kind: "eventLog",
    fake: "n/a",
    witness: { fixture: "event-sourcing", effects: "wire" },
  },
  { sourceType: "postgres", kind: "replica", fake: "n/a", pending: pending("#5617") },
  { sourceType: "mysql", kind: "state", fake: "real-sidecar", pending: pending("#5617") },
  { sourceType: "mysql", kind: "snapshot", fake: "real-sidecar", pending: pending("#5617") },
  { sourceType: "mysql", kind: "replica", fake: "real-sidecar", pending: pending("#5617") },
  { sourceType: "mysql", kind: "eventLog", fake: "real-sidecar", pending: pending("#5617") },
  { sourceType: "sqlite", kind: "state", fake: "n/a", pending: pending("#5617") },
  { sourceType: "sqlite", kind: "snapshot", fake: "n/a", pending: pending("#5617") },
  { sourceType: "sqlite", kind: "replica", fake: "n/a", pending: pending("#5617") },
  { sourceType: "sqlite", kind: "eventLog", fake: "n/a", pending: pending("#5617") },
  { sourceType: "inMemory", kind: "state", fake: "n/a", pending: pending("#5617") },
  { sourceType: "inMemory", kind: "snapshot", fake: "n/a", pending: pending("#5617") },
  { sourceType: "inMemory", kind: "eventLog", fake: "n/a", pending: pending("#5617") },
  { sourceType: "inMemory", kind: "cache", fake: "n/a", pending: pending("#4440") },
  // ── brokers, caches, logs: real, pinned sidecars ──────────────────────
  {
    sourceType: "redis",
    kind: "cache",
    fake: "real-sidecar",
    module: "broker-sidecar.mjs",
    pending: pending("#4440"),
  },
  {
    sourceType: "redis",
    kind: "channel",
    fake: "real-sidecar",
    module: "broker-sidecar.mjs",
    witness: { fixture: "channels-broker-redis", effects: "broker" },
  },
  {
    sourceType: "rabbitmq",
    kind: "queue",
    fake: "real-sidecar",
    module: "broker-sidecar.mjs",
    witness: { fixture: "resources", effects: "broker" },
  },
  {
    sourceType: "rabbitmq",
    kind: "channel",
    fake: "real-sidecar",
    module: "broker-sidecar.mjs",
    witness: { fixture: "channels-broker", effects: "broker" },
  },
  // A Kafka-held event log is refused on every backend: an event-sourced
  // aggregate keeps its log on its state database.
  { sourceType: "kafka", kind: "eventLog", fake: "n/a", refused: "loom.target-unsupported" },
  {
    sourceType: "kafka",
    kind: "channel",
    fake: "real-sidecar",
    module: "broker-sidecar.mjs",
    witness: { fixture: "channels-broker-kafka", effects: "broker" },
  },
  // ── object stores ──────────────────────────────────────────────────────
  {
    sourceType: "s3",
    kind: "objectStore",
    fake: "real-sidecar",
    module: "s3-sidecar.mjs",
    witness: { fixture: "resources", effects: "objects" },
  },
  {
    sourceType: "localDisk",
    kind: "objectStore",
    fake: "in-process-fake",
    module: "local-disk.mjs",
    witness: { fixture: "resources-localdisk", effects: "files" },
  },
  // ── outbound apis and mail ─────────────────────────────────────────────
  {
    sourceType: "restApi",
    kind: "api",
    fake: "in-process-fake",
    module: "http.mjs",
    witness: { fixture: "resource-mail-api", effects: "http" },
  },
  {
    sourceType: "smtp",
    kind: "mailer",
    fake: "real-sidecar",
    module: "mailpit-sidecar.mjs",
    witness: { fixture: "resource-mail-api", effects: "mail" },
  },
  {
    sourceType: "ses",
    kind: "mailer",
    fake: "in-process-fake",
    module: "ses.mjs",
    witness: { fixture: "resource-mailer-ses", effects: "mail" },
  },
  {
    sourceType: "sendgrid",
    kind: "mailer",
    fake: "in-process-fake",
    module: "sendgrid.mjs",
    witness: { fixture: "resource-mailer-sendgrid", effects: "mail" },
  },
  // ── auth ───────────────────────────────────────────────────────────────
  { sourceType: "oidc", kind: "auth", fake: "in-process-fake", pending: pending("#5846") },
  // ── parse as storage types, bind to no kind ────────────────────────────
  { sourceType: "elastic", kind: "state", fake: "n/a", unbindable: true },
  { sourceType: "meilisearch", kind: "state", fake: "n/a", unbindable: true },
  { sourceType: "clickhouse", kind: "state", fake: "n/a", unbindable: true },
  { sourceType: "bigquery", kind: "state", fake: "n/a", unbindable: true },
];
