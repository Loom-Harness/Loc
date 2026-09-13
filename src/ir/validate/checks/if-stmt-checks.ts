// ---------------------------------------------------------------------------
// `if` statement placement gates (M-FT.11).
//
// The `if <cond> { … } else { … }` STATEMENT renders on the four backends that
// share the `_stmt/target.ts` spine — node (Hono), dotnet, java, python — and,
// since M-T6.59, on ELIXIR too (`src/generator/elixir/vanilla/if-stmt-emit.ts`
// renders it as a value-producing `record = if … do … record else … record end`,
// because Elixir is immutable and a binding made inside an `if` block does not
// escape it).
//
// Two places it can be WRITTEN still do not render it, and both would be SILENT
// without a gate here (the repo's rule: a gap is either implemented or it
// carries a `loom.*` code — never a dropped statement):
//
//  1. THREE narrow sub-shapes on a context an ELIXIR backend hosts, each with
//     its own `#slug` message (see `elixirIfRefusal` + the `#event-sourced`
//     arm): a `return` inside a branch (an EARLY EXIT the linear body renderers
//     cannot express without restructuring the statements that follow it), a
//     `precondition`/`requires` inside a branch (the op path hoists top-level
//     guards into a `with :ok <- ensure(…)` chain that answers 403/422; a
//     nested one would fall through to the inline `raise` and answer 500), and
//     any `if` in an EVENT-SOURCED command body (whose statements are sorted
//     into `with`-clauses / a `let` preamble / an `events = […]` list, not
//     rendered as a statement sequence).
//
//  2. A UI page / component / store body, on ANY frontend.  A page body is an
//     expression tree: it expresses a condition as a VALUE (a ternary or
//     `match`), and the JS walker / Feliz update / Flutter notifier / HEEx
//     handler emitters each have no statement-position conditional.  They fail
//     fast on an unknown statement kind, so without this gate the author gets a
//     codegen crash instead of a diagnostic.
//
// Both gates are placement-only: the statement itself is already lowered and
// validated like any other.  When a target learns to render it, delete its arm
// here (and its defensive `throw`) in the same PR — the gate ratchets.
//
// NOTE — a projection fold needs NO arm here: `loom.projection-fold-impure`
// (`projection-checks.ts`, `foldImpurity`) refuses an `if` in a fold on EVERY
// backend, so the elixir-only arm this file used to carry for `ctx.projections`
// was dead by construction.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { EnrichedLoomModel, StmtIR } from "../../types/loom-ir.js";
import { aggregateIsEventSourced } from "../../util/resolve-datasource.js";
import { walkExprStmtsDeep, walkStmtDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** True when any statement in `stmts` (or nested in one of them, or in a
 *  block-body lambda one of them carries) is an `if`. */
function containsIf(stmts: readonly StmtIR[]): boolean {
  let found = false;
  for (const s of stmts) {
    walkStmtDeep(s, (n) => {
      if (n.kind === "if") found = true;
    });
  }
  return found;
}

/** True when any statement reachable from `s` (itself included, and inside a
 *  block-body lambda it carries) matches `pred`.  Rides `walkStmtDeep` rather
 *  than hand-enumerating children — the `ir-walk-census` rule. */
function anyStmtDeep(s: StmtIR, pred: (n: StmtIR) => boolean): boolean {
  let found = false;
  walkStmtDeep(s, (n) => {
    if (pred(n)) found = true;
  });
  return found;
}

/** How the vanilla Phoenix emitters render the body an `if` sits in — which is
 *  what decides whether a given `if` shape is expressible there.
 *
 *  - `"operation"` — an aggregate operation body (`operation-returns-emit.ts`,
 *    reused by `context-emit.ts` + `document-emit.ts`).  The body threads a
 *    REBOUND `record` and the caller APPENDS a persist / success tail after it,
 *    so a branch may assign (rebinding through the value-producing `if`) but
 *    cannot `return` early.
 *  - `"value"` — a pure `function` body (`function-emit.ts`) or a
 *    `domainService` operation body (`domain-service-emit.ts`).  Nothing is
 *    appended: the body's value IS its tail expression, so a TAIL `if` whose
 *    every branch ends in `return` renders exactly (the `if` becomes the
 *    function's value).
 *  - `"event-sourced"` — an ES command body (`eventsourced-emit.ts`), which is
 *    not rendered as a statement sequence at all. */
export type ElixirIfBodyKind = "operation" | "value" | "event-sourced";

export type ElixirIfRefusal = "return-in-branch" | "guard-in-branch" | "event-sourced";

/** Every `return` reachable in `stmts` is in TAIL position of its own block —
 *  the shape a `"value"` body can render, because the block's last expression
 *  IS its value.  A non-tail `return` (or a tail `if` missing its `else`, whose
 *  false path would answer `nil` instead of the other branch's value) is not. */
function returnsAreTailOnly(stmts: readonly StmtIR[]): boolean {
  for (let i = 0; i < stmts.length; i++) {
    const s = stmts[i]!;
    const isLast = i === stmts.length - 1;
    if (s.kind === "return") {
      if (!isLast) return false;
      continue;
    }
    if (s.kind === "if") {
      if (!isLast) {
        if (anyStmtDeep(s, (n) => n.kind === "return")) return false;
        continue;
      }
      if (!s.elseBody || s.elseBody.length === 0) {
        return !anyStmtDeep(s, (n) => n.kind === "return");
      }
      if (!returnsAreTailOnly(s.thenBody)) return false;
      if (!returnsAreTailOnly(s.elseBody)) return false;
      continue;
    }
    if (anyStmtDeep(s, (n) => n.kind === "return")) return false;
  }
  return true;
}

/** The `#slug` of the `loom.elixir-if-stmt-unsupported` sub-shape the `if`
 *  statements in `stmts` trip, or `undefined` when the vanilla renderers render
 *  every one of them.
 *
 *  Exported so the Elixir emitters' defensive arms classify with the SAME
 *  predicate the gate uses — the two can never drift into disagreeing about
 *  which shape is refused. */
export function elixirIfRefusal(
  stmts: readonly StmtIR[],
  kind: ElixirIfBodyKind,
): ElixirIfRefusal | undefined {
  let sawIf = false;
  let guardInBranch = false;
  for (const top of stmts) {
    walkStmtDeep(top, (n) => {
      if (n.kind !== "if") return;
      sawIf = true;
      const branches = [...n.thenBody, ...(n.elseBody ?? [])];
      if (
        branches.some((b) =>
          anyStmtDeep(b, (m) => m.kind === "precondition" || m.kind === "requires"),
        )
      ) {
        guardInBranch = true;
      }
    });
  }
  if (!sawIf) return undefined;
  if (kind === "event-sourced") return "event-sourced";
  if (guardInBranch) return "guard-in-branch";
  // A `return` inside a branch is an EARLY EXIT.  Only a `"value"` body can
  // express it, and only when every `return` is already in tail position.
  const hasBranchReturn = stmts.some((top) => {
    let found = false;
    walkStmtDeep(top, (n) => {
      if (n.kind !== "if") return;
      const branches = [...n.thenBody, ...(n.elseBody ?? [])];
      if (branches.some((b) => anyStmtDeep(b, (m) => m.kind === "return"))) found = true;
    });
    return found;
  });
  if (!hasBranchReturn) return undefined;
  if (kind === "value" && returnsAreTailOnly(stmts)) return undefined;
  return "return-in-branch";
}

export function validateIfStatementPlacement(
  loom: EnrichedLoomModel,
  diags: LoomDiagnostic[],
): void {
  validateElixirIfSupport(loom, diags);
  validatePageBodyIf(loom, diags);
}

/** Gate 1 — the three `if` sub-shapes a vanilla Phoenix body cannot render, in
 *  a domain body whose context an elixir deployable emits. */
function validateElixirIfSupport(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  for (const sys of loom.systems) {
    // context name → the elixir deployable that emits it (first one wins; the
    // message names a concrete deployable so the author can find it).
    const elixirHost = new Map<string, string>();
    for (const dep of sys.deployables) {
      if (dep.platform !== "elixir") continue;
      for (const cn of dep.contextNames) if (!elixirHost.has(cn)) elixirHost.set(cn, dep.name);
    }
    if (elixirHost.size === 0) continue;
    for (const mod of sys.subdomains) {
      for (const ctx of mod.contexts) {
        const depName = elixirHost.get(ctx.name);
        if (!depName) continue;
        // One `diags.push` per `#slug`, spelled out rather than folded behind a
        // computed key: `diagnostic-catalog.test.ts` reads the `message:`
        // expression at each site and only recognises a literal
        // `diagMessage("<key>", …)` (or a two-arm ternary of them), so a
        // slug chosen in a local variable would read as inline wording.
        const push = (where: string, slug: ElixirIfRefusal): void => {
          const params = { where, name: depName };
          const source = `${ctx.name}/${where}`;
          if (slug === "return-in-branch") {
            diags.push({
              severity: "error",
              code: "loom.elixir-if-stmt-unsupported",
              message: diagMessage("loom.elixir-if-stmt-unsupported#return-in-branch", params),
              source,
            });
          } else if (slug === "guard-in-branch") {
            diags.push({
              severity: "error",
              code: "loom.elixir-if-stmt-unsupported",
              message: diagMessage("loom.elixir-if-stmt-unsupported#guard-in-branch", params),
              source,
            });
          } else {
            diags.push({
              severity: "error",
              code: "loom.elixir-if-stmt-unsupported",
              message: diagMessage("loom.elixir-if-stmt-unsupported#event-sourced", params),
              source,
            });
          }
        };
        /** The renderable-shape gate: only the narrow sub-shapes. */
        const flag = (where: string, stmts: readonly StmtIR[], kind: ElixirIfBodyKind): void => {
          const slug = elixirIfRefusal(stmts, kind);
          if (slug) push(where, slug);
        };
        for (const agg of ctx.aggregates) {
          // An EVENT-SOURCED command body is not rendered as a statement
          // sequence at all (`eventsourced-emit.ts` sorts its statements into
          // `with`-clauses / `let`s / an `events = […]` list), so ANY `if` in
          // one is refused — not just the sub-shapes above.
          const opKind: ElixirIfBodyKind = aggregateIsEventSourced(agg)
            ? "event-sourced"
            : "operation";
          for (const op of agg.operations) {
            flag(`operation '${agg.name}.${op.name}'`, op.statements, opKind);
          }
          for (const fn of agg.functions) {
            if (!("stmts" in fn.body)) continue;
            // A pure `function` body renders the same way on an ES aggregate as
            // on a relational one (`function-emit.ts`) — a tail value.
            flag(`function '${agg.name}.${fn.name}'`, fn.body.stmts, "value");
          }
        }
        for (const svc of ctx.domainServices) {
          for (const op of svc.operations) {
            flag(`domainService operation '${svc.name}.${op.name}'`, op.body, "value");
          }
        }
      }
    }
  }
}

/** Gate 2 — an `if` anywhere in a ui body, on every frontend. */
function validatePageBodyIf(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  for (const sys of loom.systems) {
    for (const ui of sys.uis) {
      const flag = (where: string, stmts: readonly StmtIR[]): void => {
        if (!containsIf(stmts)) return;
        diags.push({
          severity: "error",
          code: "loom.if-stmt-page-body-unsupported",
          message: diagMessage("loom.if-stmt-page-body-unsupported", { where, uiName: ui.name }),
          source: `${ui.name}/${where}`,
        });
      };
      // A page/component BODY is an expression, but its inline handler lambdas
      // (`onClick: e => { … }`) carry statement blocks — reached through
      // `walkExprStmtsDeep`, the same channel `walkStmtDeep` uses internally.
      const bodyStmts = (body: unknown): StmtIR[] => {
        const out: StmtIR[] = [];
        walkExprStmtsDeep(body as never, (s) => out.push(s));
        return out;
      };
      for (const p of ui.pages) {
        for (const a of p.actions) flag(`page '${p.name}' action '${a.name}'`, a.body);
        flag(`page '${p.name}' body`, bodyStmts(p.body));
      }
      for (const c of ui.components) {
        for (const a of c.actions) flag(`component '${c.name}' action '${a.name}'`, a.body);
        flag(`component '${c.name}' body`, bodyStmts(c.body));
      }
      for (const st of ui.stores) {
        for (const a of st.actions) flag(`store '${st.name}' action '${a.name}'`, a.body);
      }
    }
  }
}
