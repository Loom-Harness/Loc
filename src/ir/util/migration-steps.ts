import type { MigrationStep } from "../types/migrations-ir.js";

// ---------------------------------------------------------------------------
// Transaction placement of a generation's migration steps.
//
// Every backend runner applies a generation inside a transaction, except the
// steps Postgres refuses to run in one: an `addIndex` with `concurrently`
// (`CREATE INDEX CONCURRENTLY`).  Each backend emits those steps as a second
// migration unit of the same generation, applied outside a transaction and
// recorded in the runner's ledger on its own, right after the transactional
// unit.  This module is the one place that decides which steps go where, so
// the runners cannot disagree.
// ---------------------------------------------------------------------------

/** True for a step that Postgres cannot run inside a transaction block. */
export function isNonTransactionalStep(step: MigrationStep): boolean {
  return step.op === "addIndex" && step.concurrently === true;
}

/** True when a generation has a non-transactional unit. */
export function hasNonTransactionalSteps(steps: readonly MigrationStep[]): boolean {
  return steps.some(isNonTransactionalStep);
}

/** A generation's steps split into its transactional unit and its
 *  non-transactional one, each in original order.  The non-transactional unit
 *  runs after the transactional one: a concurrent index can name a column the
 *  same generation adds, and no step of a generation depends on an index the
 *  generation creates (the diff orders index creation after every other
 *  structural step but the CHECK adds, which do not use indexes). */
export function splitTransactionalSteps(steps: readonly MigrationStep[]): {
  transactional: MigrationStep[];
  nonTransactional: MigrationStep[];
} {
  const transactional: MigrationStep[] = [];
  const nonTransactional: MigrationStep[] = [];
  for (const s of steps) (isNonTransactionalStep(s) ? nonTransactional : transactional).push(s);
  return { transactional, nonTransactional };
}
