// -------------------------------------------------------------------------
// `loom.aggregate-not-constructible` (ADVISORY) — an aggregate no code path
// can ever bring into existence.
//
// `aggregate Policy { … }` with no `create`, no `with crudish`, and no
// workflow or handler that builds one parses `0 error(s), 0 warning(s)`, emits
// a repository, a table and a read-only route set, and answers
// `405 Method Not Allowed` to `POST /api/policies`.  The table can only ever
// be empty, so every read over it is dead code — and the compiler already
// knows: the ui scaffold correctly omits the "new" page for exactly this
// aggregate.  The information was present and never surfaced.
//
// ADVISORY, not a warning, and the measurement is the argument.  Across the
// 177 `.ddd` sources that lower cleanly in-tree (318 aggregates) this fires 62
// times, and spot-checking says every one is TRUE: `dashboard-system.ddd`
// counts Customers nothing can create, `examples/lifecycle.ddd` declares a
// `Counters` repository over an uncreatable `Counter`, and `inheritance.ddd`
// deliberately leaves `Vendor`/`Machine`/`Vehicle` without a create because
// its subject is TPC/TPH table emission, not routes.  That last group is the
// point: a read-only aggregate fed by a migration, a seed script or an
// out-of-band importer is a coherent choice, and a fixture that exists to pin
// one emitter never needs a create at all.  True everywhere, wrong nowhere,
// and not always worth acting on — which is the definition `advisory.ts`
// gives the `Suggestions:` channel.
//
// This supersedes the note on `validateRegistryConstructible`
// (`tenancy-checks.ts`), which measured the same idea at 233/496 and rejected
// it as a warning.  That number is what the rule costs WITHOUT carve-outs; the
// five below take it to 62, and moving the remainder off the warning count is
// what makes the rest of it payable.  The registry check now shares this
// module's predicate rather than keeping its own copy — same question, one
// answer, and the registry's own diagnostic stays an ordinary warning because
// a tenant registry with no create is not "read-only", it is a signup loop
// that cannot start.
//
// What counts as a construction path (deliberately generous — an advisory
// that cries wolf gets muted):
//
//   * a declared `create` / any lifecycle create — including the ones
//     `with crudish` and the scaffold macros expand into;
//   * `Agg.create({ … })` anywhere in a workflow create / reactor / `handle`,
//     or in a top-level `commandHandler` — found by walking the statement
//     trees, so a construction inside a `for-each` or an `if-let` branch
//     counts too;
//   * a `savesAtExit` entry naming it (over-approximates: saving a MUTATED
//     row counts as constructing, which errs toward silence);
//   * a seed row;
//   * an `apply(e: Event)` applier — the row is folded from an event stream,
//     never inserted by a route;
//   * being the base of a declared subtype: creating the subtype creates the
//     base's row under both TPH and TPC.  `abstract` is excluded for the same
//     reason, one step earlier.
// -------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { BoundedContextIR, WorkflowStmtIR } from "../../types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** Every aggregate name some code path in `ctx` can bring into existence.
 *
 *  Shared with `validateRegistryConstructible` (tenancy-checks.ts): the two
 *  diagnostics ask the same question of different aggregates, so they must not
 *  answer it differently. */
export function constructibleAggregates(ctx: BoundedContextIR): Set<string> {
  const built = new Set<string>();

  // `Agg.create({ … })` lowers to a `factory-let` in a workflow / handler body.
  // `walkWorkflowStmtsDeep` descends the `for-each` / `if-let` bodies, so a
  // construction inside a branch counts — a top-level-only scan would report a
  // FALSE positive on it (`ir-walk-census`, the #2720/#2705 defect class).
  const scan = (statements: readonly WorkflowStmtIR[] | undefined): void => {
    for (const top of statements ?? []) {
      walkWorkflowStmtsDeep(top, (s) => {
        if (s.kind === "factory-let") built.add(s.aggName);
      });
    }
  };

  for (const wf of ctx.workflows) {
    // `savesAtExit` over-approximates (a saved MUTATION counts), which is the
    // safe direction for an advisory.
    for (const s of wf.savesAtExit) built.add(s.aggName);
    scan(wf.statements);
    for (const c of wf.creates ?? []) {
      for (const s of c.savesAtExit) built.add(s.aggName);
      scan(c.statements);
    }
    for (const h of wf.handlers ?? []) {
      for (const s of h.savesAtExit ?? []) built.add(s.aggName);
      scan(h.statements);
    }
    for (const o of wf.subscriptions ?? []) {
      for (const s of o.savesAtExit ?? []) built.add(s.aggName);
      scan(o.statements);
    }
  }
  for (const ch of ctx.commandHandlers ?? []) {
    for (const s of ch.savesAtExit ?? []) built.add(s.aggName);
    scan(ch.statements);
  }
  for (const seed of ctx.seeds ?? []) for (const r of seed.rows ?? []) built.add(r.aggregate);

  return built;
}

export function validateAggregateConstructible(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
): void {
  const built = constructibleAggregates(ctx);
  // Creating a subtype writes the base's row under both TPH and TPC, so a base
  // with a constructible descendant is constructible.
  const isBase = new Set(
    ctx.aggregates.map((a) => a.extendsAggregate).filter((n): n is string => n !== undefined),
  );

  for (const agg of ctx.aggregates) {
    if (agg.isAbstract || isBase.has(agg.name)) continue;
    if ((agg.appliers ?? []).length > 0) continue;
    if (agg.canonicalCreate || (agg.creates ?? []).length > 0) continue;
    if (built.has(agg.name)) continue;
    diags.push({
      severity: "warning",
      code: "loom.aggregate-not-constructible",
      message: diagMessage("loom.aggregate-not-constructible", { name: agg.name }),
      source: `${ctx.name}/${agg.name}`,
      origin: agg.origin,
    });
  }
}
