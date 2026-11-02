// ---------------------------------------------------------------------------
// `loom.elixir-match-stmt-unsupported` — the statement `match` sub-shapes
// Phoenix cannot render.
//
// A `match` whose arms run statements is legal in an aggregate operation /
// `create` / `destroy`, a domain-service operation, a workflow `create` / `on`
// and a `commandHandler` / `queryHandler` body.  The vanilla Phoenix emitters
// render it in each:
//
//   * an operation body threads its rebound `record` through a value-producing
//     `case` (`vanilla/match-stmt-emit.ts`, the `if` statement's pattern): every
//     clause ends in `record`, and the whole expression rebinds it;
//   * a domain-service body is a tail value, so a tail `match` whose every arm
//     `return`s IS the function's value;
//   * a workflow / handler body is a `with`-chain, so the `match` is one
//     `{:ok, _} <- (case … end)` clause whose arms end in `{:ok, _}` (or the
//     first `{:error, _}` they hit).
//
// A union subject's runtime value is the tagged tuple an `or`-returning call
// answers — `{:ok, value}` for the success variant, `{:error, "Tag", fields}`
// for an `error` one — so each arm is a tuple pattern; a `T?` subject is a
// presence `if`.
//
// FIVE sub-shapes stay refused, each with its own `#slug` (the
// `loom.elixir-if-stmt-unsupported` pattern, and for the same reasons):
//
//   * `#return-in-arm` — a `return` in an arm of an operation body, or a
//     non-tail one in a domain-service body: an Elixir body has no early exit.
//   * `#guard-in-arm` — a `precondition` / `requires` in an arm of an
//     operation or domain-service body: the op path hoists guards into a
//     leading `with :ok <- ensure(…)` chain (403 / 422); a nested one would
//     fall through to the inline `raise` and answer 500.
//   * `#arm-statement` — a statement kind outside the arm vocabulary the
//     `if` statement's branch already has (an `emit`, a provenanced write): the
//     supporting machinery is decided by one-level scans of the body.
//   * `#event-sourced` — any statement `match` in an event-sourced command
//     body or `eventSourced` workflow handler, which is sorted into
//     `with`-clauses / `let`s / an `events = […]` list rather than rendered as
//     a statement sequence.
//   * `#multi-success` — a union subject with more than one non-error
//     variant.  The success value travels bare in `{:ok, value}`, so two
//     success variants are indistinguishable at runtime.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { variantTag } from "../../stdlib/unions.js";
import type {
  BoundedContextIR,
  EnrichedLoomModel,
  StmtIR,
  TypeIR,
  WorkflowStmtIR,
} from "../../types/loom-ir.js";
import { aggregateIsEventSourced } from "../../util/resolve-datasource.js";
import { walkStmtDeep, walkWorkflowStmtsDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";
import { anyStmtDeep, type ElixirIfBodyKind, returnsAreTailOnly } from "./if-stmt-checks.js";

export type ElixirMatchRefusal =
  | "return-in-arm"
  | "guard-in-arm"
  | "arm-statement"
  | "event-sourced"
  | "multi-success";

/** The statement kinds an arm may contain, per body kind — the `if` branch
 *  vocabulary, closed for the same reason (see `BRANCH_VOCABULARY` in
 *  `if-stmt-checks.ts`): a new `StmtIR` kind is refused in an arm until
 *  someone decides what it means there. */
const ARM_VOCABULARY: Readonly<Record<ElixirIfBodyKind, ReadonlySet<StmtIR["kind"]>>> = {
  operation: new Set([
    "assign",
    "add",
    "remove",
    "let",
    "expression",
    "call",
    "if",
    "variant-match",
  ]),
  value: new Set(["let", "expression", "return", "if", "call", "variant-match"]),
  "event-sourced": new Set([]),
};

/** True when `tag` names an `error` payload of `ctx` — the variants that ride
 *  `{:error, "Tag", fields}` rather than `{:ok, value}`. */
function errorTagOf(ctx: Pick<BoundedContextIR, "payloads">): (tag: string) => boolean {
  const errors = new Set(ctx.payloads.filter((p) => p.kind === "error").map((p) => p.name));
  return (tag) => errors.has(tag);
}

/** True when a union subject has two or more non-error variants — the shape
 *  whose success values cannot be told apart at runtime.  A `T?` (absence)
 *  subject is a presence check and never trips it. */
function matchHasSeveralSuccessVariants(
  subjectType: TypeIR | undefined,
  subjectShape: "absence" | undefined,
  ctx: Pick<BoundedContextIR, "payloads">,
): boolean {
  if (subjectShape === "absence" || subjectType?.kind !== "union") return false;
  const isError = errorTagOf(ctx);
  return subjectType.variants.filter((v) => !isError(variantTag(v))).length > 1;
}

/** The `#slug` of the `loom.elixir-match-stmt-unsupported` sub-shape the
 *  statement `match`es in an operation / domain-service body trip, or
 *  `undefined` when the vanilla renderers render every one of them.
 *
 *  Exported so the Elixir emitters' defensive arms classify with the SAME
 *  predicate the gate uses. */
export function elixirMatchRefusal(
  stmts: readonly StmtIR[],
  kind: ElixirIfBodyKind,
  ctx: Pick<BoundedContextIR, "payloads">,
): ElixirMatchRefusal | undefined {
  let sawMatch = false;
  let multiSuccess = false;
  let guardInArm = false;
  let outOfVocabulary = false;
  let returnInArm = false;
  const allowed = ARM_VOCABULARY[kind];
  for (const top of stmts) {
    walkStmtDeep(top, (n) => {
      if (n.kind !== "variant-match") return;
      sawMatch = true;
      if (matchHasSeveralSuccessVariants(n.subjectType, n.subjectShape, ctx)) multiSuccess = true;
      const arms = [...n.arms.flatMap((a) => a.body), ...(n.elseBody ?? [])];
      for (const b of arms) {
        if (anyStmtDeep(b, (m) => m.kind === "precondition" || m.kind === "requires")) {
          guardInArm = true;
        }
        if (anyStmtDeep(b, (m) => m.kind === "return")) returnInArm = true;
        if (
          anyStmtDeep(b, (m) => {
            // A guard and a `return` each have their own arm, with advice the
            // author can act on.
            if (m.kind === "precondition" || m.kind === "requires") return false;
            if (m.kind === "return") return false;
            if (!allowed.has(m.kind)) return true;
            // A PROVENANCED write renders, but `opHasProvSite` scans top-level
            // statements only.
            return (
              (m.kind === "assign" || m.kind === "add" || m.kind === "remove") &&
              m.prov !== undefined
            );
          })
        ) {
          outOfVocabulary = true;
        }
      }
    });
  }
  if (!sawMatch) return undefined;
  if (kind === "event-sourced") return "event-sourced";
  if (multiSuccess) return "multi-success";
  if (guardInArm) return "guard-in-arm";
  if (outOfVocabulary) return "arm-statement";
  if (!returnInArm) return undefined;
  // A `return` in an arm is an early exit; only a tail-value body whose every
  // `return` is already in tail position renders it.
  if (kind === "value" && returnsAreTailOnly(stmts)) return undefined;
  return "return-in-arm";
}

/** The `#slug` for the statement `match`es of a workflow / handler body.  Its
 *  arms render through the same `with`-chain machinery as an `if let` branch
 *  (guards, op calls and nested control flow included; a `return` there is
 *  refused on every backend), so only the subject shape can be refused. */
function elixirWorkflowMatchRefusal(
  stmts: readonly WorkflowStmtIR[],
  ctx: Pick<BoundedContextIR, "payloads">,
  /** True for an `eventSourced` workflow, whose handlers are sorted into
   *  guard clauses, `let`s and one `events = […]` list
   *  (`workflow-eventsourced-emit.ts`) rather than rendered as a with-chain. */
  eventSourced = false,
): ElixirMatchRefusal | undefined {
  let sawMatch = false;
  let multiSuccess = false;
  for (const top of stmts) {
    walkWorkflowStmtsDeep(top, (n) => {
      if (n.kind !== "variant-match") return;
      sawMatch = true;
      if (matchHasSeveralSuccessVariants(n.subjectType, n.subjectShape, ctx)) multiSuccess = true;
    });
  }
  if (!sawMatch) return undefined;
  if (eventSourced) return "event-sourced";
  return multiSuccess ? "multi-success" : undefined;
}

export function validateElixirMatchStatements(
  loom: EnrichedLoomModel,
  diags: LoomDiagnostic[],
): void {
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
        // One `diags.push` per `#slug`, each `diagMessage` a literal key with an
        // object-literal params bag — the shape `diagnostic-catalog.test.ts`
        // and `diagnostic-message-hygiene.test.ts` read.
        const push = (where: string, slug: ElixirMatchRefusal): void => {
          const source = `${ctx.name}/${where}`;
          if (slug === "return-in-arm") {
            diags.push({
              severity: "error",
              code: "loom.elixir-match-stmt-unsupported",
              message: diagMessage("loom.elixir-match-stmt-unsupported#return-in-arm", {
                where,
                name: depName,
              }),
              source,
            });
          } else if (slug === "guard-in-arm") {
            diags.push({
              severity: "error",
              code: "loom.elixir-match-stmt-unsupported",
              message: diagMessage("loom.elixir-match-stmt-unsupported#guard-in-arm", {
                where,
                name: depName,
              }),
              source,
            });
          } else if (slug === "event-sourced") {
            diags.push({
              severity: "error",
              code: "loom.elixir-match-stmt-unsupported",
              message: diagMessage("loom.elixir-match-stmt-unsupported#event-sourced", {
                where,
                name: depName,
              }),
              source,
            });
          } else if (slug === "multi-success") {
            diags.push({
              severity: "error",
              code: "loom.elixir-match-stmt-unsupported",
              message: diagMessage("loom.elixir-match-stmt-unsupported#multi-success", {
                where,
                name: depName,
              }),
              source,
            });
          } else {
            diags.push({
              severity: "error",
              code: "loom.elixir-match-stmt-unsupported",
              message: diagMessage("loom.elixir-match-stmt-unsupported#arm-statement", {
                where,
                name: depName,
              }),
              source,
            });
          }
        };
        const flag = (where: string, stmts: readonly StmtIR[], kind: ElixirIfBodyKind): void => {
          const slug = elixirMatchRefusal(stmts, kind, ctx);
          if (slug) push(where, slug);
        };
        const flagWorkflow = (
          where: string,
          stmts: readonly WorkflowStmtIR[],
          eventSourced = false,
        ): void => {
          const slug = elixirWorkflowMatchRefusal(stmts, ctx, eventSourced);
          if (slug) push(where, slug);
        };
        for (const agg of ctx.aggregates) {
          // An event-sourced command body is not a statement sequence at all.
          const opKind: ElixirIfBodyKind = aggregateIsEventSourced(agg)
            ? "event-sourced"
            : "operation";
          for (const op of agg.operations) {
            flag(`operation '${agg.name}.${op.name}'`, op.statements, opKind);
          }
          for (const c of agg.creates ?? []) {
            flag(`create '${agg.name}.${c.name}'`, c.statements, opKind);
          }
          for (const d of agg.destroys ?? []) {
            flag(`destroy '${agg.name}.${d.name}'`, d.statements, opKind);
          }
        }
        for (const svc of ctx.domainServices) {
          for (const op of svc.operations) {
            flag(`domainService operation '${svc.name}.${op.name}'`, op.body, "value");
          }
        }
        for (const wf of ctx.workflows) {
          const bodies = [
            ...(wf.creates ?? []).map((c) => c.statements),
            ...(wf.subscriptions ?? []).map((s) => s.statements),
          ];
          flagWorkflow(`workflow '${wf.name}'`, bodies.flat(), wf.eventSourced === true);
        }
        for (const h of ctx.commandHandlers ?? []) {
          flagWorkflow(`commandHandler '${h.name}'`, h.statements);
        }
        for (const h of ctx.queryHandlers ?? []) {
          flagWorkflow(`queryHandler '${h.name}'`, h.statements);
        }
      }
    }
  }
}
