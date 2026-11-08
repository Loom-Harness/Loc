// ---------------------------------------------------------------------------
// Loop-gate implication lint — advisory `loom.loop-gate-not-implied`.
//
// THE SHAPE.  A sweep loops over a list read and calls a `when`-gated
// operation on every row:
//
//     operation close() when status == Resolved { status := Closed }
//     criterion Stale of Ticket = this.age > 30
//     commandHandler SweepStale() {
//       let ts = Tickets.all(Stale())
//       for t in ts { t.close() }
//     }
//
// Every row the read returns that is not `Resolved` fails the gate at runtime
// (409 Disallowed), so the sweep aborts on the first such row.  The author
// almost always meant the read to select only rows the gate admits —
// `criterion StaleResolved of Ticket = this.age > 30 && this.status ==
// Resolved`.
//
// THE CHECK IS SYNTACTIC, AND ADVISORY.  Each top-level `&&` conjunct of the
// gate must appear, structurally, among the `&&` conjuncts of the read's
// `where` (criterion body or declared retrieval predicate, as enrichment
// materialises it).  That proves implication when it holds; when it does not,
// the data may still happen to satisfy the gate, or the predicate may imply
// it by reasoning a conjunct subset cannot see (`age > 40` vs `age > 30`), so
// this is a suggestion on the advisory channel, never a warning or an error.
//
// SCOPE.  A `for-each` whose iterable is a local bound by `let x =
// Repo.all(<Criterion | Retrieval>)` (`repo-run`), in a workflow, a
// commandHandler or a queryHandler body; the gated call is an `op-call` on the
// loop variable, at any depth inside the loop body.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { BoundedContextIR, ExprIR, WorkflowStmtIR } from "../../types/loom-ir.js";
import { walkWorkflowStmtsDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** The top-level `&&` conjuncts of `e`, parentheses dropped. */
function conjuncts(e: ExprIR): ExprIR[] {
  if (e.kind === "paren") return conjuncts(e.inner);
  if (e.kind === "binary" && e.op === "&&") return [...conjuncts(e.left), ...conjuncts(e.right)];
  return [e];
}

/** Annotations that carry no part of an expression's meaning: source spans and
 *  the types lowering attaches. */
const ANNOTATIONS = new Set([
  "origin",
  "type",
  "leftType",
  "rightType",
  "resultType",
  "receiverType",
  "memberType",
]);

/** A structural key for a conjunct: its shape without annotations, with the
 *  two spellings of an own-field read made one.  A `when` gate reads a field
 *  as a `this-prop` ref (`status`), a criterion as a member of `this`
 *  (`this.status`). */
const shapeKey = (e: ExprIR): string =>
  JSON.stringify(e, (k, v: unknown) => {
    if (ANNOTATIONS.has(k)) return undefined;
    const n = v as { kind?: unknown; refKind?: unknown; name?: unknown };
    const m = v as { receiver?: { kind?: unknown }; member?: unknown };
    if (n?.kind === "ref" && n.refKind === "this-prop") return { field: n.name };
    if (n?.kind === "member" && m.receiver?.kind === "this") return { field: m.member };
    return v;
  });

/** The gate conjuncts `where` does not syntactically carry. */
function unimplied(gate: ExprIR, where: ExprIR | undefined): ExprIR[] {
  const have = new Set((where ? conjuncts(where) : []).map(shapeKey));
  return conjuncts(gate).filter((c) => !have.has(shapeKey(c)));
}

/** Every statement body of the context that runs workflow statements. */
function bodies(ctx: BoundedContextIR): { label: string; statements: WorkflowStmtIR[] }[] {
  return [
    ...ctx.workflows.flatMap((wf) => [
      ...wf.creates.map((c) => ({ label: `workflow '${wf.name}'`, statements: c.statements })),
      ...(wf.subscriptions ?? []).map((s) => ({
        label: `workflow '${wf.name}'`,
        statements: s.statements,
      })),
    ]),
    ...(ctx.commandHandlers ?? []).map((h) => ({
      label: `commandHandler '${h.name}'`,
      statements: h.statements,
    })),
    ...(ctx.queryHandlers ?? []).map((h) => ({
      label: `queryHandler '${h.name}'`,
      statements: h.statements,
    })),
  ];
}

export function validateLoopGateImplication(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  const retrievals = new Map((ctx.retrievals ?? []).map((r) => [r.name, r] as const));
  const gates = new Map<string, { when: ExprIR; whenSource?: string }>();
  for (const agg of ctx.aggregates) {
    for (const op of agg.operations) {
      if (op.when)
        gates.set(`${agg.name}.${op.name}`, { when: op.when, whenSource: op.whenSource });
    }
  }
  if (gates.size === 0) return;

  for (const body of bodies(ctx)) {
    // `let x = Repo.all(<Ref>)` bindings, by local name.
    const runs = new Map<string, string>();
    const loops: Extract<WorkflowStmtIR, { kind: "for-each" }>[] = [];
    for (const st of body.statements) {
      walkWorkflowStmtsDeep(st, (n) => {
        if (n.kind === "repo-run") runs.set(n.name, n.retrievalName);
        else if (n.kind === "for-each") loops.push(n);
      });
    }
    for (const loop of loops) {
      if (loop.iterable.kind !== "ref") continue;
      const sourceName = loop.iterable.name;
      const retrievalName = runs.get(sourceName);
      if (retrievalName === undefined) continue;
      const where = retrievals.get(retrievalName)?.where;
      const seen = new Set<string>();
      for (const st of loop.body) {
        walkWorkflowStmtsDeep(st, (n) => {
          if (n.kind !== "op-call" || n.target !== loop.var) return;
          const key = `${n.aggName}.${n.op}`;
          const gate = gates.get(key);
          if (!gate || seen.has(key)) return;
          seen.add(key);
          const missing = unimplied(gate.when, where);
          if (missing.length === 0) return;
          diags.push({
            severity: "warning",
            code: "loom.loop-gate-not-implied",
            message: diagMessage("loom.loop-gate-not-implied", {
              where: body.label,
              loopVar: loop.var,
              source: sourceName,
              op: `${n.aggName}.${n.op}`,
              gate: gate.whenSource ?? "its `when` gate",
            }),
            source: `${ctx.name}/${body.label}`,
            ...(loop.origin ? { origin: loop.origin } : {}),
          });
        });
      }
    }
  }
}
