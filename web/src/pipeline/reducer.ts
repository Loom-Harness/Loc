// Pipeline reducer.
//
// Single rule: every transition that kicks an upstream stage MUST
// clear every downstream slot.  Encoding that here means handlers
// just dispatch the action they care about — no scattered
// `setBundleResult(null)` / `setBootedDDL(null)` etc. that used to
// rot every time we added a new pipeline step.

import {
  initialPipelineState,
  type PipelineAction,
  type PipelineState,
} from "./state.js";

// Slot defaults — reused in invalidation cascades.
const NONE_GENERATE = { kind: "none" } as const;
const NONE_BUNDLE = { kind: "none" } as const;
const NONE_BOOT = { kind: "none" } as const;
const NONE_DISPATCH = { kind: "none" } as const;

export function pipelineReducer(
  state: PipelineState,
  action: PipelineAction,
): PipelineState {
  switch (action.type) {
    case "RESET":
      return initialPipelineState;

    // ---- Generate -----------------------------------------------------
    case "GENERATE_START":
      return {
        ...state,
        generating: true,
        // Kicking generate invalidates every downstream slot;
        // the previously-generated tree no longer matches the
        // source, so the bundle / boot / dispatch state is stale.
        bundle: NONE_BUNDLE,
        boot: NONE_BOOT,
        dispatch: NONE_DISPATCH,
      };
    case "GENERATE_DONE":
      return {
        ...state,
        generating: false,
        generate: { kind: "result", result: action.result },
      };

    // ---- Bundle -------------------------------------------------------
    case "BUNDLE_START":
      return {
        ...state,
        bundling: true,
        // Re-bundling invalidates boot + dispatch but leaves the
        // generate tree intact (the source hasn't changed).
        boot: NONE_BOOT,
        dispatch: NONE_DISPATCH,
      };
    case "BUNDLE_DONE":
      return {
        ...state,
        bundling: false,
        bundle: {
          kind: "result",
          backends: action.backends,
          react: action.react,
        },
      };

    // ---- Boot ---------------------------------------------------------
    case "BOOT_START":
      return {
        ...state,
        booting: true,
        boot: NONE_BOOT,
        // Reboot wipes the previous PGlite + drops dispatch.
        dispatch: NONE_DISPATCH,
      };
    case "BOOT_OK":
      return {
        ...state,
        booting: false,
        boot: {
          kind: "ok",
          ddl: action.ddl,
          persistent: action.persistent,
          applied: action.applied,
          backends: action.backends,
          deployables: action.deployables,
          storages: action.storages,
        },
        database: { kind: "at", head: action.head },
      };
    case "BOOT_PENDING":
      return {
        ...state,
        booting: false,
        boot: { kind: "pending", migration: action.migration, message: action.message },
        // The boot read the database's head before it stopped; a database
        // the chain cannot describe has no head the chain can measure.
        database:
          action.migration.kind === "unrecorded"
            ? { kind: "at", head: action.migration.head }
            : { kind: "unknown" },
      };
    case "BOOT_FAIL":
      return {
        ...state,
        booting: false,
        boot: { kind: "fail", message: action.message, ...(action.at ? { at: action.at } : {}) },
      };

    // ---- Migration chain check ----------------------------------------
    // Independent of the cascade: a source edit re-checks without touching
    // the generate / bundle / boot slots, and a regenerate keeps the check.
    // The check re-runs after every edit and nearly always confirms what the
    // slot already holds; returning the same state then keeps React from
    // re-rendering the whole app for nothing.  The slot is plain data, so its
    // JSON is its identity.
    case "MIGRATION_CHECKED":
      if (JSON.stringify(state.migrationCheck) === JSON.stringify(action.check)) return state;
      return { ...state, migrationCheck: action.check };

    // ---- Dispatch -----------------------------------------------------
    case "DISPATCH_START":
      return { ...state, dispatching: true };
    case "DISPATCH_DONE":
      return {
        ...state,
        dispatching: false,
        dispatch: { kind: "result", result: action.result },
      };
    case "DISPATCH_CLEAR":
      return { ...state, dispatch: NONE_DISPATCH };

    // ---- Runtime worker respawn (lost state) --------------------------
    case "RUNTIME_LOST": {
      // The fresh worker has no PGlite + no imported bundle, so the
      // previous `boot.kind === "ok"` is no longer true.  Surface it
      // as a fail so the Backend panel shows the message instead of
      // staying green with a phantom DDL.  Clear dispatch too — any
      // pending response from the old worker will never arrive.
      // Leave bundle + generate untouched; they're main-thread state.
      //
      // The PGlite database itself may or may not survive depending
      // on how the previous boot landed:
      //   - `persistent: true`  →  OPFS-backed, keyed by
      //     workspace.  The fresh worker reattaches the same island on
      //     the next Boot — rows are preserved.
      //   - `persistent: false` →  in-memory only (Safari private
      //     mode, hostile-storage policies).  The data lived inside
      //     the dead worker's heap and is genuinely gone.
      // We surface the right wording for each case so the user
      // knows whether they need to recreate test data.
      const wasPersistent =
        state.boot.kind === "ok" && state.boot.persistent;
      const message = wasPersistent
        ? "The runtime worker was terminated while the tab was in the background.  Click Boot to reattach — your rows are persisted in OPFS and will be restored."
        : "The runtime worker was terminated while the tab was in the background.  Click Boot to start a fresh PGlite — the previous database was in-memory only, so any rows from this session are gone.";
      return {
        ...state,
        boot: { kind: "fail", message },
        dispatch: NONE_DISPATCH,
        // An in-memory database died with the worker; the next boot starts
        // an empty one.
        database: wasPersistent ? state.database : { kind: "unknown" },
      };
    }
  }
}

export { initialPipelineState };
export type { PipelineState, PipelineAction };
