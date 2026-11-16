// How a generated context-integration test is isolated from the next one.
//
// A context-integration test drives the real repositories against a real
// database, in process.  Every test starts from the database the migrations
// left, whatever the tests before it wrote and in whatever order they run: it
// runs inside one transaction, rolled back at its end.  Two tests that each
// create an `Order` and count `Order.all()` both see one.  Committing instead
// made the count depend on test order and on the previous run.
//
// Each test framework renders the transaction in its idiom (a drizzle
// transaction around the body, `@Transactional` on the class, a per-test
// `BeginTransaction`, a session that is never committed, the Ecto sandbox);
// the repositories' own transactions join it.

import type { BoundedContextIR } from "../types/loom-ir.js";

export type IntegrationIsolation = { kind: "rollback-per-test" };

/** The isolation every context-integration test of `ctx` runs under. */
export function integrationIsolation(_ctx: BoundedContextIR): IntegrationIsolation {
  return { kind: "rollback-per-test" };
}
