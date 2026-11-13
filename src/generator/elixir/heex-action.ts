// `Action(<instance>.<operation>)` on a LiveView page — a button that runs an
// aggregate operation on an in-scope record or row.
//
// The shared `emitAction` binds the operation through a client mutation
// handle; a LiveView runs it server-side from a hoisted `handle_event` clause
// instead, so `heexTarget.renderAction` takes the whole primitive here: the
// button names the clause (`phx-click`, the record id as `phx-value-id`) and
// the clause itself is emitted from the `ActionBinding` this records.

import type { ExprIR, OperationIR } from "../../ir/types/loom-ir.js";
import { operationActionGates } from "../../ir/util/op-gates.js";
import { humanize, snake } from "../../util/naming.js";
import { tryRenderGate } from "../_frontend/gate-expr.js";
import { giveUpText } from "../_walker/give-up.js";
import { renderExpr, type WalkContext } from "./heex-walker-core.js";

/** `Action(<instance>.<operation>, then?)` → a `<.button phx-click=…>`
 *  whose event loads the instance by id and invokes the operation.
 *  The operation is referenced through an in-scope aggregate instance
 *  (a component param or a QueryView record), resolved via
 *  `instanceTypes`.  The handler is recorded as an `ActionBinding` and
 *  hoisted to the host page's LiveView by the emitter. */
export function renderHeexAction(
  expr: Extract<ExprIR, { kind: "call" }>,
  ctx: WalkContext,
): string {
  const opRef = expr.args.find((_, i) => !expr.argNames?.[i]);
  if (opRef?.kind !== "member" || opRef.receiver.kind !== "ref") {
    return `<!-- ${giveUpText("loom.page-primitive-arg-invalid", "Action: expected <instance>.<operation>")} -->`;
  }
  const instanceName = opRef.receiver.name;
  const opName = opRef.member;
  // A record (`instanceTypes`), or a ROW of a list — the `phx-value-id` then
  // carries that row's own id.
  const aggName = ctx.instanceTypes?.get(instanceName) ?? ctx.rowTypes?.get(instanceName);
  if (!aggName) {
    return `<!-- ${giveUpText("loom.page-ref-unreachable", `Action(${instanceName}.${opName}): '${instanceName}' is not an in-scope aggregate instance`)} -->`;
  }
  const agg = ctx.aggregatesByName.get(aggName);
  const op = agg?.operations.find((o) => o.name === opName && o.visibility === "public");
  if (!op) {
    return `<!-- ${giveUpText("loom.page-ref-unreachable", `Action(${instanceName}.${opName}): no public operation '${opName}' on ${aggName}`)} -->`;
  }
  const eventName = `${snake(opName)}_${snake(aggName)}`;
  const idExpr = `${renderExpr(opRef.receiver, { ...ctx, position: "template" })}.id`;
  // `then: navigate(<Page>)` → push_navigate route (snake convention,
  // matching renderNavigate / the scaffold router).
  let thenRoute: string | undefined;
  for (let i = 0; i < expr.args.length; i++) {
    if (expr.argNames?.[i] !== "then") continue;
    const eff = expr.args[i]!;
    if (eff.kind === "call" && eff.name === "navigate") {
      const target = eff.args[0];
      // A STRING argument is a literal route path — the shape a body uses when a
      // page REF can't address the route unambiguously (every scaffolded
      // aggregate names its list page `List`).  Twin of the JSX-side arm in
      // `walker-core.ts`'s `tryRenderNavigateCall`.
      if (target && target.kind === "literal" && target.lit === "string") thenRoute = target.value;
      else if (target && target.kind === "ref") thenRoute = `/${snake(target.name)}`;
    }
  }
  if (!ctx.actionBindings.some((b) => b.eventName === eventName)) {
    ctx.actionBindings.push({
      agg: aggName,
      op: snake(opName),
      opName,
      eventName,
      thenRoute,
    });
  }
  const button = `<.button phx-click="${eventName}" phx-value-id={${idExpr}}>${humanize(opName)}</.button>`;
  return gateActionButton(button, op, ctx);
}

/** Wrap an `Action` `<.button>` in a server-side currentUser gate when the
 *  host deployable has auth AND every `requires` predicate on the operation
 *  is currentUser-only — the LiveView/HEEx mirror of the JSX frontends'
 *  action-button gating (`emitAction` in _walker/primitives/controls.ts).
 *
 *  Gating signal: `ctx.authEnabled` (the deployable runs `auth: required`,
 *  so `LiveAuth.on_mount` assigns `@current_user`).  Without auth there is
 *  no `@current_user` to read, so the button is left ungated and the output
 *  stays byte-identical.  An op with no `requires`, or any predicate that
 *  touches `this.<field>` / params (not currentUser-only — `tryRenderGate`
 *  returns null), is also left ungated; the operation still enforces the
 *  gate server-side regardless (defence-in-depth). */
export function gateActionButton(button: string, op: OperationIR, ctx: WalkContext): string {
  if (!ctx.authEnabled) return button;
  const gates = operationActionGates(op);
  if (gates.length === 0) return button;
  // Classify with the JS gate-expr (currentUser-only ⇒ non-null); gate only
  // when EVERY predicate is currentUser-only.  The rendered Elixir gate is
  // produced by `renderExpr` in template scope (`@current_user.…`), NOT by
  // the JS renderer — `tryRenderGate` is used purely as the classifier.
  if (!gates.every((g) => tryRenderGate(g, "currentUser") !== null)) return button;
  const tmplCtx: WalkContext = { ...ctx, position: "template" };
  // Multiple `requires` clauses combine with Elixir's `and` (the JSX mirror
  // uses `&&`); `renderExpr` already emits `@current_user.…` in template
  // scope, so the parenthesised predicates compose directly inside `if`.
  const gate = gates.map((g) => `(${renderExpr(g, tmplCtx)})`).join(" and ");
  return `<%= if (${gate}) do %>${button}<% end %>`;
}
