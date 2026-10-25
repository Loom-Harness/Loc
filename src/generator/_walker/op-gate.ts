// The `can_<op>` probe of a `when`-gated operation trigger, shared by every
// walker primitive that renders one (`Modal { OperationForm }`, a bare
// `OperationForm`, `Action`).
import type { AggregateIR } from "../../ir/types/loom-ir.js";
import { upperFirst } from "../../util/naming.js";
import { tryRenderGate } from "../_frontend/gate-expr.js";
import { localizedPageChromeValue } from "./i18n-emit.js";
import type { OpGateState, WalkContext } from "./walker-core.js";

/** The `can_<op>` probe wiring for a `when`-gated operation trigger, or
 *  undefined for an ungated op (no probe query, byte-identical output).  Every
 *  backend serves `GET /{id}/can_<op>` → `{ allowed }` for exactly the ops that
 *  carry `when` (`api-surface.ts`'s `gateProbe`); the trigger disables while it
 *  answers false instead of opening a dialog whose submit can only 409.
 *  The caller registers the probe hook's import the way it registers the
 *  mutation hook's (an `addImport`, or a hoisted `actionMutations` entry). */
export function opGateFor(
  ctx: WalkContext,
  agg: AggregateIR,
  op: AggregateIR["operations"][number],
  local = `can${upperFirst(op.name)}`,
): OpGateState | undefined {
  if (!op.when) return undefined;
  const hook = `useCan${upperFirst(op.name)}${agg.name}`;
  return {
    local,
    hook,
    disabledExpr: ctx.target.renderOpGateDisabled?.(local) ?? `${local}.data?.allowed === false`,
    reasonExpr: localizedPageChromeValue(ctx, "opNotAllowed"),
  };
}

/** The client-side spelling of an operation's `requires` gate for a trigger
 *  rendered on an `auth: ui` frontend, or null when the trigger stays visible.
 *
 *  The action-level mirror of a page's `requires` guard: when EVERY `requires`
 *  predicate on the op reads only `currentUser`, the verified session claims
 *  decide it in the browser, so a principal the backend would answer 403 does
 *  not see the button at all.  An op with no `requires`, or one whose gate
 *  reads `this.<field>` or a param (`tryRenderGate` returns null — not
 *  client-evaluable), keeps its trigger; the backend still enforces every gate.
 *  Sets `ctx.usesCurrentUser` so the page shell binds `currentUser`.
 *
 *  Shared by `Action` and the `Modal { OperationForm }` trigger on the JS
 *  targets; Feliz, Flutter and HEEx spell the same predicate in their own
 *  language (`opActionGate` / `gateActionButton`). */
export function opRequiresClientGate(
  op: AggregateIR["operations"][number],
  ctx: WalkContext,
): string | null {
  if (!ctx.authUi) return null;
  const gates = op.statements.filter((s) => s.kind === "requires").map((s) => s.expr);
  if (gates.length === 0) return null;
  const parts = gates.map((g) => tryRenderGate(g, "currentUser"));
  if (!parts.every((p) => p !== null)) return null;
  ctx.usesCurrentUser = true;
  return parts.map((p) => `(${p})`).join(" && ");
}
