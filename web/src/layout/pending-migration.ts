// The pipeline strip's migration badge, as data — pure, so the root vitest
// suite pins every state's wording without React.
//
// The badge reads `pendingMigration(pipeline)`: the recorded chain measured
// against the live source on every source change, and against the database
// the last boot reached.  It offers the two actions that clear it: **Record
// migration…** (`ddd migrate add`) while the model has unrecorded changes,
// **Apply** (a boot, which applies the recorded entries) once they are
// recorded and the running database is behind.

import type { PendingMigration } from "../pipeline/state";
import { PENDING_MIGRATION } from "./vocabulary";

export interface PendingMigrationView {
  /** `data-kind` on the badge. */
  kind: Exclude<PendingMigration["kind"], "up-to-date">;
  /** The badge's headline — `migration required` / `migration recorded`. */
  title: string;
  /** What is pending — `initial schema`, `3 unrecorded changes`,
   *  `1 migration not applied`. */
  detail: string;
  /** One sentence for the tooltip and the Problems notice. */
  hint: string;
  destructive: boolean;
  /** The action the badge offers. */
  action: "record" | "apply";
}

/** The badge for `p`; `null` when there is nothing to show (no check yet, a
 *  source without a system, or the chain and the database are at the model). */
export function describePendingMigration(p: PendingMigration | null): PendingMigrationView | null {
  if (p === null) return null;
  switch (p.kind) {
    case "up-to-date":
      return null;
    case "unrecorded":
      return p.initial
        ? {
            kind: "unrecorded",
            title: PENDING_MIGRATION.required,
            detail: PENDING_MIGRATION.initial,
            hint: PENDING_MIGRATION.initialHint(p.modules),
            destructive: false,
            action: "record",
          }
        : {
            kind: "unrecorded",
            title: PENDING_MIGRATION.required,
            detail: PENDING_MIGRATION.unrecorded(p.steps),
            hint: PENDING_MIGRATION.unrecordedHint(p.steps, p.modules, p.destructive),
            destructive: p.destructive,
            action: "record",
          };
    case "recorded-not-applied":
      return {
        kind: "recorded-not-applied",
        title: PENDING_MIGRATION.recorded,
        detail: PENDING_MIGRATION.notApplied(p.units.length),
        hint: PENDING_MIGRATION.notAppliedHint(p.units),
        destructive: false,
        action: "apply",
      };
    default: {
      const _exhaustive: never = p;
      return null;
    }
  }
}

/** Whether Boot waits for the initial migration: with nothing recorded the
 *  database cannot be created, so the strip asks for the record first. */
export function bootAwaitsInitialMigration(p: PendingMigration | null): boolean {
  return p !== null && p.kind === "unrecorded" && p.initial;
}
