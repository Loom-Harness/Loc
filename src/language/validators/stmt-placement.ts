// Placement rules for the three statements whose LOWERING is positional
// (M-T5.28, audit findings F1 + F4).
//
// Three of the `Statement` alternatives are not lowerable everywhere the
// grammar admits them, and nothing said so.  Each produced a SILENT decline:
//
//   - `match s { V b => … }` used for its EFFECTS (`MatchStmt`) lowers to a
//     `variant-match` StmtIR that only the frontend walkers render.  In a
//     domain body it reached `renderStmt`'s backend dispatcher and THREW
//     (`src/generator/_stmt/target.ts`) on node, dotnet, elixir, java and
//     python alike — a stack trace after `0 error(s), 0 warning(s)`.
//   - `for v in xs { … }` (`ForStmt`) and `if let v = src { … }`
//     (`IfLetStmt`) are lowered only by `lowerWorkflowStatement`
//     (`src/ir/lower/lower-workflow.ts`).  The DOMAIN statement lowerer
//     (`lower-stmt.ts`) has no arm for either, so both fell through to its
//     fallback and emitted `this.<unknown>()` / `self._<unknown>()` /
//     `_ = <unknown>(record)` — output that compiles on no backend and that
//     the pipeline reported as clean.
//
// Phase ④, not phase ⑦, because this is where the construct is still VISIBLE.
// `for` / `if let` have no IR node at all outside a workflow — the lowering
// has already replaced them with the `<unknown>` call sentinel by the time an
// IR check leaf could look — so an IR-level gate could only pattern-match on
// the sentinel, which is a proxy for the defect rather than the defect.  The
// AST knows the construct and its exact span, and containment alone decides
// the answer, so the check needs nothing the IR would add.
//
// TWO PERMANENT REFUSALS AND ONE HONEST GAP (ruling D-FOR-IN-DOMAIN,
// `docs/new-plan/completion-waves-2026-09.md` §5 #3):
//
//   - `variant-match` outside a ui action  — permanent.  The effect form of
//     `match` IS the frontend action vocabulary (`async-actions-and-effects.md`
//     Stage 2): its arms navigate, write page state and show toasts.  There is
//     nothing for a backend to lower it INTO.
//   - `if let` outside a workflow          — permanent.  It binds the optional
//     result of a repository read; a domain body reaches its own state through
//     `this`, and cross-aggregate reads from inside an aggregate are already
//     refused (`loom.infra-call-from-aggregate`).
//   - `for` outside a workflow             — an honest GAP with a named
//     successor mission (M-T5.30).  Nothing about a loop is workflow-specific;
//     only the per-iteration save the workflow lowering owns is.  The message
//     says so, so the refusal does not read as a design rule it is not.
//
// The zone is decided by CONTAINMENT and nothing else, which is why this is a
// single `streamAllContents` pass rather than a hook per body owner.

import { type AstNode, AstUtils, type ValidationAcceptor } from "langium";
import { diagMessage } from "../../diagnostics/messages.js";
import {
  isActionDecl,
  isApply,
  isCommandHandler,
  isComponent,
  isCreate,
  isDestroy,
  isDomainServiceOperation,
  isForStmt,
  isFunctionDecl,
  isHandleDecl,
  isIfLetStmt,
  isMatchStmt,
  isOnDecl,
  isOperation,
  isPage,
  isProjectionOn,
  isQueryHandler,
  isStore,
  isUi,
  isWorkflowCreateDecl,
  type Model,
} from "../generated/ast.js";

/** Which lowerer owns the body a statement sits in.
 *
 *  `frontend` — a page / component / store action body (or a lambda block
 *  inside one): lowered by `lowerUiAction` and rendered by the six walker
 *  targets.
 *  `workflow` — a workflow `create` / `handle` / `on` body, or a top-level
 *  `commandHandler` / `queryHandler`: lowered by `lowerWorkflowStatement`.
 *  `domain` — an aggregate / value-object member, a domain-service operation
 *  or a projection fold: lowered by `lowerStatement`.
 *  `unknown` — no classifying ancestor (only reachable from a detached node);
 *  no rule fires, so a future body owner degrades to silence-as-today rather
 *  than to a false refusal. */
type Zone = "frontend" | "workflow" | "domain" | "unknown";

/** Walk outwards to the first node that decides the zone.  The nesting
 *  statements (`if` / `for` / `if let` / `match` arms) and `Lambda` are
 *  transparent: they inherit the zone of whatever body they sit in. */
function zoneOf(node: AstNode): Zone {
  for (let c: AstNode | undefined = node.$container; c; c = c.$container) {
    if (isActionDecl(c) || isPage(c) || isComponent(c) || isStore(c) || isUi(c)) return "frontend";
    if (
      isWorkflowCreateDecl(c) ||
      isHandleDecl(c) ||
      isOnDecl(c) ||
      isCommandHandler(c) ||
      isQueryHandler(c)
    ) {
      return "workflow";
    }
    if (
      isOperation(c) ||
      isCreate(c) ||
      isDestroy(c) ||
      isApply(c) ||
      isFunctionDecl(c) ||
      isDomainServiceOperation(c) ||
      isProjectionOn(c)
    ) {
      return "domain";
    }
  }
  return "unknown";
}

/** A lowercase noun phrase naming the body the offending statement sits in,
 *  for the message's second half ("… but this one is in <owner>"). */
function describeOwner(node: AstNode): string {
  for (let c: AstNode | undefined = node.$container; c; c = c.$container) {
    if (isActionDecl(c)) return `action '${c.name}'`;
    if (isOperation(c)) return `operation '${c.name}'`;
    if (isFunctionDecl(c)) return `function '${c.name}'`;
    if (isDomainServiceOperation(c)) return `domain-service operation '${c.name}'`;
    if (isCreate(c)) return "a 'create' body";
    if (isDestroy(c)) return "a 'destroy' body";
    if (isApply(c)) return "an 'apply' fold";
    if (isProjectionOn(c)) return "a projection 'on' fold";
    if (isCommandHandler(c)) return `commandHandler '${c.name}'`;
    if (isQueryHandler(c)) return `queryHandler '${c.name}'`;
    if (isWorkflowCreateDecl(c) || isHandleDecl(c) || isOnDecl(c)) return "a workflow body";
    if (isPage(c)) return `page '${c.name}'`;
    if (isComponent(c)) return `component '${c.name}'`;
    if (isStore(c)) return `store '${c.name}'`;
  }
  return "this body";
}

export function checkStatementPlacement(model: Model, accept: ValidationAcceptor): void {
  for (const node of AstUtils.streamAllContents(model)) {
    // The effect form of `match` — frontend-only, permanently.
    if (isMatchStmt(node)) {
      if (zoneOf(node) === "frontend") continue;
      accept("error", diagMessage("loom.variant-match-placement", { owner: describeOwner(node) }), {
        node,
        property: "subject",
        code: "loom.variant-match-placement",
      });
      continue;
    }
    // `if let` — workflow / handler bodies only, permanently.
    if (isIfLetStmt(node)) {
      if (zoneOf(node) === "workflow") continue;
      accept("error", diagMessage("loom.if-let-placement", { owner: describeOwner(node) }), {
        node,
        property: "var",
        code: "loom.if-let-placement",
      });
      continue;
    }
    // `for … in …` — workflow / handler bodies only TODAY (M-T5.30).
    if (isForStmt(node)) {
      if (zoneOf(node) === "workflow") continue;
      accept("error", diagMessage("loom.for-placement", { owner: describeOwner(node) }), {
        node,
        property: "var",
        code: "loom.for-placement",
      });
    }
  }
}
