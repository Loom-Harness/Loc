// Phase ⑥ write fact — `checksVersion`: for every write path, whether the save
// is checked against a version, and which version.
//
// A write to a row another request may also be writing has two guards
// (docs/capabilities.md "Two guards, not one"):
//
//   - the THINK-TIME guard: the client sends the version it was looking at as
//     an `If-Match` entity-tag, and a write whose tag is stale is refused 409;
//   - the WRITE-TIME guard: the save is conditioned on the version the saving
//     handle was loaded at (`UPDATE … WHERE version = $expected` for a row, the
//     `(stream_type, stream_id, version)` key for an event stream — RS-41), so
//     two handles that both loaded version N cannot both land.
//
// Which guard a write path runs used to be decided in each backend's emitter,
// and the backends disagreed: node and elixir read `If-Match` only on the
// canonical `update`, java and python on every named operation (#3531).  This
// module is the one answer.  It is DERIVED, never stamped (CLAUDE.md "Derive,
// don't stamp"): a pure function of the aggregate's `versioned` capability, its
// persistence (`persistedAs: eventLog`) and saving shape, and — for a workflow
// or handler body — of the body's effects (`ir/util/effects.ts`).
//
// The rules, per write path:
//
//   create       — `none`.  A fresh row or stream has no loaded version; a
//                  second create of the same id is the primary key's business.
//   operation    — a `versioned` row: `if-match` (the client's tag, falling
//                  back to the handle's loaded version when the header is
//                  absent).  An event-sourced stream: `handle` (the stream
//                  version the fold reached; `If-Match` on a stream is #3994).
//                  Otherwise `none`.
//   destroy      — RULED `if-match` for a `versioned` row, like an operation;
//                  `none` until the backends implement it (no backend reads
//                  `If-Match` on DELETE or conditions the delete on a version
//                  yet), so the contract carries the ruling as `pending`.
//   persist      — a workflow / handler save: `handle` for a row or stream the
//                  body LOADED; `none` for one it CREATED (an insert).  A body
//                  is not a request about one row, so it never reads `If-Match`.
//
// A write that loses its check answers 409, and the CLIENT decides whether to
// retry — with or without `If-Match`.  The server never re-runs domain logic on
// its own: a silent retry would apply a command against state the caller never
// saw.  Owner rulings: https://github.com/Loom-Harness/Loc/issues/3593#issuecomment-6417721869

import type { EffectIR } from "../types/effect-ir.js";
import type { AggregateIR, OperationIR, SavingShape } from "../types/loom-ir.js";
import type { EffectBodyIR } from "../util/effects.js";
import { bodyEffects } from "../util/effects.js";
import { aggregateIsEventSourced } from "../util/resolve-datasource.js";
import { aggregateIsVersioned } from "../util/versioned-capability.js";

/** Which version a write path's save is checked against.
 *
 *   - `if-match` — the client's `If-Match` entity-tag; with the header absent,
 *                  the version the handle was loaded at (so the write-time
 *                  guard always runs).  Either way a lost check is a 409 the
 *                  client may retry; the server does not.
 *   - `handle`   — the version the saving handle was loaded at, only.
 *   - `none`     — the save is not checked against any version. */
export type ChecksVersion = "if-match" | "handle" | "none";

/** What the expected version guards: the `version` column of a row (any
 *  saving shape — relational, embedded, document), or the next `version` of an
 *  event stream. */
export type VersionGuard = "row-version" | "stream-version";

/** The store a write lands in: a saving shape, or the event log. */
export type WriteStore = SavingShape | "eventLog";

/** Why a write path checks nothing. */
export type UncheckedReason =
  /** The write inserts a row / starts a stream — no version was loaded. */
  | "insert"
  /** The aggregate carries no version to check (not `versioned`, not a stream). */
  | "unversioned"
  /** A delete: no backend conditions it on a version yet (see `pending`). */
  | "destroy";

/** A ruled contract the backends do not implement yet: what the path WILL
 *  check, and the issue that moves every backend onto it. */
export interface PendingVersionCheck {
  checksVersion: Exclude<ChecksVersion, "none">;
  guard: VersionGuard;
  issue: string;
}

/** One write path's concurrency contract. */
export type VersionCheck =
  | { checksVersion: Exclude<ChecksVersion, "none">; guard: VersionGuard; store: WriteStore }
  | {
      checksVersion: "none";
      reason: UncheckedReason;
      store: WriteStore;
      /** Set when the path is ruled to check a version but no backend does yet. */
      pending?: PendingVersionCheck;
    };

/** A write path of an aggregate. */
export type WritePath =
  | { kind: "create"; op: OperationIR }
  | { kind: "operation"; op: OperationIR }
  | { kind: "destroy"; op: OperationIR };

/** The store an aggregate's writes land in.  `agg.savingShape` is the header's
 *  `shape:`; a per-binding override reaches the same three row shapes, all of
 *  which carry the same `version` column, so the guard does not depend on it. */
function writeStoreFor(agg: AggregateIR): WriteStore {
  return aggregateIsEventSourced(agg) ? "eventLog" : (agg.savingShape ?? "relational");
}

/** The guard a loaded handle's save runs, or undefined when the aggregate has
 *  no version to guard. */
function saveGuardFor(agg: AggregateIR): VersionGuard | undefined {
  if (aggregateIsEventSourced(agg)) return "stream-version";
  if (aggregateIsVersioned(agg)) return "row-version";
  return undefined;
}

/** True when a loaded row's save is a guarded write on its `version` column —
 *  the repository's save takes an expected version and its row carries the
 *  counter.  False for an event stream (guarded by its own key) and for an
 *  aggregate with no version. */
export function rowVersionGuarded(agg: AggregateIR): boolean {
  return saveGuardFor(agg) === "row-version";
}

/** The contract of a `create` route: an insert, never checked. */
export function createVersionCheck(agg: AggregateIR): VersionCheck {
  return { checksVersion: "none", reason: "insert", store: writeStoreFor(agg) };
}

/** The contract of a named-operation route (void or returning, extern or
 *  not, audited / provenanced or not — the operation's shape does not change
 *  which version its save is checked against). */
export function operationVersionCheck(agg: AggregateIR, _op?: OperationIR): VersionCheck {
  const store = writeStoreFor(agg);
  const guard = saveGuardFor(agg);
  if (guard === "stream-version") return { checksVersion: "handle", guard, store };
  if (guard === "row-version") return { checksVersion: "if-match", guard, store };
  return { checksVersion: "none", reason: "unversioned", store };
}

/** The issue that moves every backend's DELETE onto the ruled contract. */
const DESTROY_IF_MATCH_ISSUE = "#4341";

/** The contract of the canonical `destroy` route: unchecked today; ruled to
 *  read `If-Match` on a `versioned` row, which `pending` records. */
export function destroyVersionCheck(agg: AggregateIR): VersionCheck {
  const store = writeStoreFor(agg);
  return rowVersionGuarded(agg)
    ? {
        checksVersion: "none",
        reason: "destroy",
        store,
        pending: { checksVersion: "if-match", guard: "row-version", issue: DESTROY_IF_MATCH_ISSUE },
      }
    : { checksVersion: "none", reason: "destroy", store };
}

/** Every route write path of an aggregate, each with its contract, in
 *  declaration order: creates, operations, destroys. */
export function writePathsFor(agg: AggregateIR): { path: WritePath; check: VersionCheck }[] {
  return [
    ...(agg.creates ?? []).map((op) => ({
      path: { kind: "create", op } as const,
      check: createVersionCheck(agg),
    })),
    ...agg.operations.map((op) => ({
      path: { kind: "operation", op } as const,
      check: operationVersionCheck(agg, op),
    })),
    ...(agg.destroys ?? []).map((op) => ({
      path: { kind: "destroy", op } as const,
      check: destroyVersionCheck(agg),
    })),
  ];
}

/** True when a route reads the client's `If-Match` for this path. */
export function readsIfMatch(check: VersionCheck): boolean {
  return check.checksVersion === "if-match";
}

/** True when some write path of the aggregate can lose a version check — the
 *  aggregate's routes need the concurrency-conflict (409) arm. */
export function aggregateCanConflict(agg: AggregateIR): boolean {
  return saveGuardFor(agg) !== undefined;
}

/** True when some aggregate's route reads `If-Match` — the project needs the
 *  entity-tag parser. */
export function anyRouteReadsIfMatch(aggs: readonly AggregateIR[]): boolean {
  return aggs.some((a) => readsIfMatch(operationVersionCheck(a)));
}

/** The contract of one derived save in a workflow / handler body: `handle`
 *  for a value the body loaded, `none` for one it created. */
function persistVersionCheck(
  persist: Extract<EffectIR, { kind: "persist" }>,
  effects: readonly EffectIR[],
  aggregates: ReadonlyMap<string, AggregateIR>,
): VersionCheck {
  const agg = aggregates.get(persist.aggName);
  const store: WriteStore = agg ? writeStoreFor(agg) : "relational";
  const created = effects.some((e) => e.kind === "create" && e.binds === persist.name);
  if (created) return { checksVersion: "none", reason: "insert", store };
  const guard = agg ? saveGuardFor(agg) : undefined;
  if (!guard) return { checksVersion: "none", reason: "unversioned", store };
  return { checksVersion: "handle", guard, store };
}

/** Every derived save of a body with its contract, in program order. */
export function bodySaveChecks(
  body: EffectBodyIR,
  aggregates: ReadonlyMap<string, AggregateIR>,
): { persist: Extract<EffectIR, { kind: "persist" }>; check: VersionCheck }[] {
  // The saves and the create / load bindings are structural; a callee's declared
  // mutations add no save, so no resolver is needed here.
  const effects = bodyEffects(body, undefined);
  return effects
    .filter((e): e is Extract<EffectIR, { kind: "persist" }> => e.kind === "persist")
    .map((persist) => ({ persist, check: persistVersionCheck(persist, effects, aggregates) }));
}
