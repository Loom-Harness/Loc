// ---------------------------------------------------------------------------
// Statement vocabulary of the bodies that do NOT ride the operation spine.
//
// An aggregate operation renders through `_stmt/target.ts` (or, on Phoenix,
// the vanilla operation emitter), whose vocabulary is the whole `StmtIR`
// union.  The event-sourced and workflow bodies have their own renderers, and
// what each position admits is declared here, once:
//
//  1. An APPLIER (`apply(e: E) { … }` on an event-sourced aggregate or an
//     `eventSourced` workflow) is a pure, replayable fold over the event, so
//     its vocabulary is target-neutral: state writes, local bindings and a
//     branch (`APPLIER_STMT_KINDS`).  `emit`, a call statement and a guard each
//     have their own code (`loom.applier-emits` / `loom.applier-impure-call` /
//     `loom.applier-guard`, with advice the author can act on); every other
//     kind — a `return` (an applier yields nothing), a bare expression
//     statement (a call made for its effect) — is `loom.applier-stmt-invalid`.
//     Not a target gap (no backend should render a `return` in a fold), hence
//     `-invalid`.
//
//  2. Across every aggregate and workflow body, an entity part is constructed
//     only inside the aggregate that owns it (`validatePartConstructionOwner`,
//     `loom.cross-aggregate-entity-part`).
//
// The per-BACKEND narrowings of these positions live with the Phoenix `if`
// shapes in `if-stmt-checks.ts` (an `if` in an applier, an event-sourced
// command body, or an early-`return` branch in a `function`) — the only ones
// left: every backend's reactor / event-triggered starter renders the whole
// `WorkflowStmtIR` vocabulary the workflow validators admit.
//
// `test/system/body-statement-census.test.ts` measures every
// (position × backend × statement kind) against these declarations: each cell
// renders or is refused, never crashes `generate`.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type {
  ApplyIR,
  BoundedContextIR,
  ExprIR,
  FunctionIR,
  StmtIR,
  WorkflowStmtIR,
} from "../../types/loom-ir.js";
import {
  walkExprDeep,
  walkStmtChildren,
  walkStmtExprsDeep,
  walkStmtsDeep,
  walkWorkflowStmtExprsDeep,
} from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** The statement kinds an applier folds on every backend. */
export const APPLIER_STMT_KINDS: ReadonlySet<StmtIR["kind"]> = new Set([
  "assign",
  "add",
  "remove",
  "let",
  "if",
]);

/** Why `s` can't sit in an applier body: the `loom.*` code it trips, or null
 *  when it folds. */
type ApplierRefusal = "emit" | "call" | "guard" | "vocabulary" | null;

function applierRefusal(s: StmtIR): ApplierRefusal {
  switch (s.kind) {
    case "emit":
      return "emit";
    case "call":
      return "call";
    case "precondition":
    case "requires":
      return "guard";
    // A statement-form `match` is refused in every domain body by
    // `loom.variant-match-placement`; it is not this file's to report twice.
    case "variant-match":
      return null;
    case "assign":
    case "add":
    case "remove":
    case "let":
    case "if":
    case "expression":
    case "return":
      return APPLIER_STMT_KINDS.has(s.kind) ? null : "vocabulary";
    default: {
      const _exhaustive: never = s;
      return _exhaustive;
    }
  }
}

/** Human label for a refused kind in the vocabulary message. */
function kindLabel(s: StmtIR): string {
  return s.kind === "expression" ? "bare expression (a call made for its effect)" : `'${s.kind}'`;
}

/** `s` and every statement nested in its BRANCHES (`if` / `variant-match`
 *  bodies) — but not inside a block-bodied lambda: a `return` in
 *  `xs.map(x => { return x })` belongs to the lambda, not to the fold. */
function branchStmtsDeep(s: StmtIR, out: StmtIR[]): void {
  out.push(s);
  walkStmtChildren(
    s,
    () => {},
    (n) => branchStmtsDeep(n, out),
  );
}

/** Rule 4 of the event-sourcing discipline, for BOTH applier owners: an
 *  applier body is a pure fold.  Deep, so a refused kind inside a branch is
 *  caught exactly like one at the top of the body. */
export function validateApplierBodies(ctx: BoundedContextIR, diags: LoomDiagnostic[]): void {
  const check = (owner: string, appliers: readonly ApplyIR[], source: string): void => {
    for (const ap of appliers) {
      // The impurity codes look everywhere, lambda blocks included (an `emit`
      // is impure wherever it sits); the vocabulary looks at the fold's own
      // statements and their branches.
      const deep: StmtIR[] = [];
      for (const top of ap.statements) walkStmtsDeep(top, (n) => deep.push(n));
      const own: StmtIR[] = [];
      for (const top of ap.statements) branchStmtsDeep(top, own);
      const ownSet = new Set(own);
      for (const stmt of deep) {
        const r = applierRefusal(stmt);
        const refusal = r === "vocabulary" && !ownSet.has(stmt) ? null : r;
        if (refusal === "emit") {
          diags.push({
            severity: "error",
            code: "loom.applier-emits",
            message: diagMessage("loom.applier-emits", { owner, event: ap.event }),
            source,
          });
        } else if (refusal === "call" && stmt.kind === "call") {
          diags.push({
            severity: "error",
            code: "loom.applier-impure-call",
            message: diagMessage("loom.applier-impure-call", {
              owner,
              event: ap.event,
              stmtName: stmt.name,
            }),
            source,
          });
        } else if (refusal === "guard") {
          diags.push({
            severity: "error",
            code: "loom.applier-guard",
            message: diagMessage("loom.applier-guard", {
              owner,
              event: ap.event,
              kind: stmt.kind,
            }),
            source,
          });
        } else if (refusal === "vocabulary") {
          diags.push({
            severity: "error",
            code: "loom.applier-stmt-invalid",
            message: diagMessage("loom.applier-stmt-invalid", {
              owner,
              event: ap.event,
              kind: kindLabel(stmt),
              allowed: [...APPLIER_STMT_KINDS].join(" / "),
            }),
            source,
          });
        }
      }
    }
  };
  for (const agg of ctx.aggregates) {
    // A non-event-sourced aggregate's appliers are refused whole
    // (`loom.applier-on-non-event-sourced`); their bodies are not checked.
    if (agg.persistedAs !== "eventLog") continue;
    check(`aggregate '${agg.name}'`, agg.appliers ?? [], `${ctx.name}/${agg.name}`);
  }
  for (const wf of ctx.workflows) {
    if (!wf.eventSourced) continue;
    check(`workflow '${wf.name}'`, wf.appliers ?? [], `${ctx.name}/${wf.name}`);
  }
}

/** An entity part is constructed (`Line { … }`) only inside the aggregate that
 *  owns it.  Every backend builds a part through its owning aggregate's
 *  renderer — Java resolves the part off the rendering aggregate, the Phoenix
 *  fold projects it from the aggregate's own part list — and a part value has
 *  nowhere to go outside that aggregate anyway: a workflow's state cannot hold
 *  one and an operation cannot take one (`loom.entity-part-param-unsupported`).
 *  The same rule as an entity-part TYPE outside its aggregate, so it carries
 *  the same code. */
export function validatePartConstructionOwner(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
): void {
  const ownerOf = new Map<string, string>();
  for (const agg of ctx.aggregates) for (const p of agg.parts) ownerOf.set(p.name, agg.name);
  const check = (where: string, own: ReadonlySet<string>, exprs: readonly ExprIR[]): void => {
    const seen = new Set<string>();
    for (const root of exprs) {
      walkExprDeep(root, (e) => {
        if (e.kind !== "new" || own.has(e.partName) || seen.has(e.partName)) return;
        const owner = ownerOf.get(e.partName);
        if (!owner) return;
        seen.add(e.partName);
        diags.push({
          severity: "error",
          code: "loom.cross-aggregate-entity-part",
          message: diagMessage("loom.cross-aggregate-entity-part#construct", {
            where,
            name: e.partName,
            ownerName: owner,
          }),
          source: `${ctx.name}/${where}`,
        });
      });
    }
  };
  const stmtExprs = (stmts: readonly StmtIR[]): ExprIR[] => {
    const out: ExprIR[] = [];
    for (const s of stmts) walkStmtExprsDeep(s, (e) => out.push(e));
    return out;
  };
  const fnExprs = (fn: FunctionIR): ExprIR[] =>
    "expr" in fn.body ? [fn.body.expr] : stmtExprs(fn.body.stmts);
  for (const agg of ctx.aggregates) {
    const own = new Set(agg.parts.map((p) => p.name));
    const bodies = [
      ...agg.operations,
      ...(agg.creates ?? []),
      ...(agg.destroys ?? []),
      ...(agg.appliers ?? []),
    ];
    check(`aggregate '${agg.name}'`, own, [
      ...bodies.flatMap((b) => stmtExprs(b.statements)),
      ...agg.functions.flatMap(fnExprs),
    ]);
  }
  const none: ReadonlySet<string> = new Set();
  for (const wf of ctx.workflows) {
    const exprs: ExprIR[] = [];
    const wfBodies: readonly (readonly WorkflowStmtIR[])[] = [
      wf.statements,
      ...wf.creates.map((c) => c.statements),
      ...(wf.subscriptions ?? []).map((o) => o.statements),
      ...(wf.handlers ?? []).map((h) => h.statements),
    ];
    for (const body of wfBodies) {
      for (const s of body) walkWorkflowStmtExprsDeep(s, (e) => exprs.push(e));
    }
    exprs.push(...(wf.appliers ?? []).flatMap((ap) => stmtExprs(ap.statements)));
    exprs.push(...(wf.functions ?? []).flatMap(fnExprs));
    check(`workflow '${wf.name}'`, none, exprs);
  }
}
