// Pipeline state machine.
//
// The playground's main flow has four sequential async stages:
//
//   generate → bundle → boot → dispatch
//
// Each stage produces a typed result, each one's success enables the
// next, and every kick of an upstream stage invalidates everything
// downstream.  Before this module the state lived in 11 disjoint
// `useState` slots in App.tsx, with manual `setBundleResult(null)`
// calls scattered across every async handler.  The "forgot to clear
// X" bug class hit twice during PR #1–#15 review (`setDiagnostics`
// not reset on example switch, `dispatchResult` lingering after
// reboot) — both were a missed setter, both would have been impossible
// in this reducer because invalidation is encoded in the transition,
// not the caller.
//
// `state` is one immutable record, `Action` is a tagged union,
// `reducer` (in ./reducer.ts) is total — one branch per action,
// each branch returns a new state with downstream slots cleared.

import type {
  GenerateResult,
  GenerateOk,
} from "../build/protocol.js";
import type {
  BundleOk,
  BundleResult,
} from "../bundle/protocol.js";
import type { BackendBundle, FrontendBundle } from "../engine/runtime-engine.js";
import type {
  BlockingMigrationState,
  BootFailAt,
  DeployableBootInfo,
  DispatchResult,
  SerializedResponse,
  UnrecordedChanges,
} from "../runtime/protocol.js";

// ---------------------------------------------------------------------
// Per-stage result slots.  Each is a tagged union of "no attempt yet"
// / success / failure.  Distinguishing "none" from "fail" matters for
// UI: an empty file tree shows "click Generate" before the user has
// done anything, "see Problems" after a failed run.
// ---------------------------------------------------------------------

export type GenerateSlot =
  | { kind: "none" }
  | { kind: "result"; result: GenerateResult };

export type BundleSlot =
  | { kind: "none" }
  /** `backends`: one bundle per Node deployable, the default dispatch
   *  target first; `frontends`: one bundle per frontend, sorted by slug. */
  | { kind: "result"; backends: BackendBundle[]; frontends: FrontendBundle[] };

export type BootSlot =
  | { kind: "none" }
  /** `applied`: the migration units this boot applied, in order.
   *  `backends`: the deployables serving, the default request target first. */
  | {
      kind: "ok";
      ddl: string;
      persistent: boolean;
      applied: string[];
      backends: string[];
      /** Each serving deployable and the storage it binds. */
      deployables: DeployableBootInfo[];
      /** The storages the boot opened, in plan order. */
      storages: string[];
    }
  /** The database is not at the model's schema and the recorded chain cannot
   *  bring it there; it was left as it is and the app did not start. */
  | { kind: "pending"; migration: BlockingMigrationState; message: string }
  | { kind: "fail"; message: string; at?: BootFailAt };

/** The recorded migration chain measured against the live source — the
 *  build worker's `migrate.plan` (`ddd migrate status`), re-run on every
 *  source change and after every record and boot, independent of the
 *  generate → bundle → boot cascade. */
export type MigrationCheckSlot =
  | { kind: "none" }
  | {
      kind: "chain";
      /** The recorded chain's migration units, root first. */
      units: string[];
      /** What `migrate add` would record; `null` when the chain records the
       *  model. */
      unrecorded: UnrecordedChanges | null;
    }
  /** A source with no system: it records no migrations. */
  | { kind: "unversioned" };

/** Which recorded unit the runtime's database is at, as far as this session
 *  has seen.  A boot learns it; regenerating or rebundling does not change
 *  the database, so only a project switch forgets it. */
export type DatabaseSlot =
  | { kind: "unknown" }
  | { kind: "at"; head: string | null };

export type DispatchSlot =
  | { kind: "none" }
  | { kind: "result"; result: DispatchResult };

// ---------------------------------------------------------------------
// Aggregate state.
// ---------------------------------------------------------------------

export interface PipelineState {
  generate: GenerateSlot;
  bundle: BundleSlot;
  boot: BootSlot;
  dispatch: DispatchSlot;
  migrationCheck: MigrationCheckSlot;
  database: DatabaseSlot;
  // Activity flags — true while the corresponding async call is
  // in flight.  Drive button `loading` props.  Folded into the
  // reducer so START/DONE pairs can't get out of sync (which used
  // to happen if an exception propagated past an early return).
  generating: boolean;
  bundling: boolean;
  booting: boolean;
  dispatching: boolean;
}

export const initialPipelineState: PipelineState = {
  generate: { kind: "none" },
  bundle: { kind: "none" },
  boot: { kind: "none" },
  dispatch: { kind: "none" },
  migrationCheck: { kind: "none" },
  database: { kind: "unknown" },
  generating: false,
  bundling: false,
  booting: false,
  dispatching: false,
};

// ---------------------------------------------------------------------
// Actions.  One per START / DONE / RESET.  No "set whatever you want"
// escape hatch — every transition has a name.
// ---------------------------------------------------------------------

export type PipelineAction =
  // Pipeline reset (example switch / explicit clear).
  | { type: "RESET" }
  // Generate
  | { type: "GENERATE_START" }
  | { type: "GENERATE_DONE"; result: GenerateResult }
  // Bundle (one Bundle click does every Hono backend + every frontend)
  | { type: "BUNDLE_START" }
  | { type: "BUNDLE_DONE"; backends: BackendBundle[]; frontends: FrontendBundle[] }
  // Boot
  | { type: "BOOT_START" }
  /** `head`: the chain unit the database is at after this boot (`null` for an
   *  empty chain or a source without a system). */
  | {
      type: "BOOT_OK";
      ddl: string;
      persistent: boolean;
      applied: string[];
      backends: string[];
      deployables: DeployableBootInfo[];
      storages: string[];
      head: string | null;
    }
  | { type: "BOOT_PENDING"; migration: BlockingMigrationState; message: string }
  | { type: "BOOT_FAIL"; message: string; at?: BootFailAt }
  // The recorded chain measured against the live source.
  | { type: "MIGRATION_CHECKED"; check: Exclude<MigrationCheckSlot, { kind: "none" }> }
  // Dispatch (a single HTTP call from the request composer)
  | { type: "DISPATCH_START" }
  | { type: "DISPATCH_DONE"; result: DispatchResult }
  // "Reset DB" — clears stale dispatch result without touching the
  // boot/bundle/generate slots, since the booted PGlite is still
  // valid (just emptied of rows).
  | { type: "DISPATCH_CLEAR" }
  // Runtime worker was killed by the browser (mobile Safari /
  // memory pressure) and the parent has just respawned a fresh
  // one.  The previous PGlite database belongs to the dead worker
  // and isn't recoverable — drop the booted slot back to a
  // failure state so the UI prompts the user to click Boot again.
  // Bundle / generate stay intact (the source + bundle code are
  // main-thread state, unaffected by the worker dying).
  | { type: "RUNTIME_LOST" };

// ---------------------------------------------------------------------
// Convenience selectors.  Keeps JSX terse + makes the read paths
// auditable in one place.
// ---------------------------------------------------------------------

export function generateOk(s: PipelineState): GenerateOk | null {
  return s.generate.kind === "result" && s.generate.result.ok
    ? s.generate.result
    : null;
}

/** The backends' bundles as one result — what the status surfaces show.  A
 *  single backend's bundle as it is; for several, ok only when every one
 *  bundled (sizes and times summed), else every failure's diagnostics, each
 *  naming its deployable. */
export function combinedBackendBundle(backends: readonly BackendBundle[]): BundleResult | null {
  const [first] = backends;
  if (!first) return null;
  if (backends.length === 1) return first.bundle;
  const failed = backends.filter((b) => !b.bundle.ok);
  if (failed.length > 0) {
    return {
      ok: false,
      diagnostics: failed.flatMap((b) =>
        b.bundle.diagnostics.map((d) => ({ ...d, message: `${b.slug}: ${d.message}` })),
      ),
    };
  }
  const oks = backends.map((b) => b.bundle as BundleOk);
  const [head] = oks;
  if (!head) return null;
  return {
    ...head,
    size: oks.reduce((n, b) => n + b.size, 0),
    durationMs: oks.reduce((n, b) => n + b.durationMs, 0),
    fetchedUrls: oks.flatMap((b) => b.fetchedUrls),
  };
}

export function honoBundleResult(s: PipelineState): BundleResult | null {
  return s.bundle.kind === "result" ? combinedBackendBundle(s.bundle.backends) : null;
}

/** The bundles a boot can start, as one result — the backends that bundled
 *  (a system boots partly; the failed ones show in `honoBundleResult`).  Null
 *  when none bundled. */
export function honoBundleOk(s: PipelineState): BundleOk | null {
  if (s.bundle.kind !== "result") return null;
  const ok = s.bundle.backends.filter((b) => b.bundle.ok);
  const r = combinedBackendBundle(ok);
  return r?.ok ? r : null;
}

/** The backends that bundled — what a boot starts.  Null when none did. */
export function backendBundlesOk(
  s: PipelineState,
): Array<{ slug: string; entry: string; bundle: BundleOk }> | null {
  if (s.bundle.kind !== "result") return null;
  const out: Array<{ slug: string; entry: string; bundle: BundleOk }> = [];
  for (const b of s.bundle.backends) {
    if (b.bundle.ok) out.push({ slug: b.slug, entry: b.entry, bundle: b.bundle });
  }
  return out.length > 0 ? out : null;
}

/** The bundle result of the frontend `slug` — or of the first frontend when
 *  `slug` names none.  Null before a bundle and when there is no frontend. */
export function frontendBundleResult(s: PipelineState, slug: string | null): BundleResult | null {
  if (s.bundle.kind !== "result") return null;
  const { frontends } = s.bundle;
  return (frontends.find((f) => f.slug === slug) ?? frontends[0])?.bundle ?? null;
}

export function reactBundleOk(s: PipelineState, slug: string | null): BundleOk | null {
  const r = frontendBundleResult(s, slug);
  return r?.ok ? r : null;
}

export function bootedDDL(s: PipelineState): string | null {
  return s.boot.kind === "ok" ? s.boot.ddl : null;
}

export function bootPersistent(s: PipelineState): boolean {
  return s.boot.kind === "ok" && s.boot.persistent;
}

/** The deployables the last boot started, the default request target first. */
export function bootBackends(s: PipelineState): string[] {
  return s.boot.kind === "ok" ? s.boot.backends : [];
}

/** Each deployable the last boot started and the storage it binds. */
export function bootDeployables(s: PipelineState): DeployableBootInfo[] {
  return s.boot.kind === "ok" ? s.boot.deployables : [];
}

/** The storages the last boot opened, in plan order. */
export function bootStorages(s: PipelineState): string[] {
  return s.boot.kind === "ok" ? s.boot.storages : [];
}

/** Where the last boot stopped, when it failed at one deployable or storage. */
export function bootFailAt(s: PipelineState): BootFailAt | null {
  return s.boot.kind === "fail" ? (s.boot.at ?? null) : null;
}

/** The migration units the last boot applied; empty when it applied none. */
export function bootApplied(s: PipelineState): string[] {
  return s.boot.kind === "ok" ? s.boot.applied : [];
}

/** Why the last boot stopped short of starting the app, when the database's
 *  migrations are the reason. */
export function bootPending(
  s: PipelineState,
): { migration: BlockingMigrationState; message: string } | null {
  return s.boot.kind === "pending" ? { migration: s.boot.migration, message: s.boot.message } : null;
}

/** Where the workspace's schema stands against its recorded migration chain
 *  and the runtime's database — what the pipeline strip's migration badge
 *  shows.  The CLI's words: `unrecorded` is what `ddd migrate status` lists
 *  and `ddd migrate add` (**Record migration**) records; `recorded-not-applied`
 *  is recorded units the database this session booted has not applied, which
 *  a boot (**Apply**) applies. */
export type PendingMigration =
  | { kind: "up-to-date" }
  | ({ kind: "unrecorded" } & UnrecordedChanges)
  | { kind: "recorded-not-applied"; units: string[] };

/** The pending-migration state, derived from the last chain check and the
 *  database head the last boot reported.  `null` while nothing is known (no
 *  check has finished) or the source records no migrations. */
export function pendingMigration(s: PipelineState): PendingMigration | null {
  const check = s.migrationCheck;
  if (check.kind !== "chain") return null;
  if (check.unrecorded) return { kind: "unrecorded", ...check.unrecorded };
  // Not booted this session: Boot applies the whole recorded chain, and
  // nothing says the database is behind it.
  if (s.database.kind === "unknown") return { kind: "up-to-date" };
  const head = s.database.head;
  // A head the chain no longer has reads as nothing applied; the boot then
  // reports the database it finds.
  const at = head === null ? 0 : check.units.indexOf(head) + 1;
  const units = check.units.slice(at);
  return units.length > 0 ? { kind: "recorded-not-applied", units } : { kind: "up-to-date" };
}

export function bootError(s: PipelineState): string | null {
  return s.boot.kind === "fail" ? s.boot.message : null;
}

export function dispatchResponse(
  s: PipelineState,
): SerializedResponse | null {
  if (s.dispatch.kind !== "result" || !s.dispatch.result.ok) return null;
  return s.dispatch.result.response;
}
