// The `can_<op>` probe of a `when`-gated operation trigger, shared by every
// walker primitive that renders one (`Modal { OperationForm }`, a bare
// `OperationForm`, `Action`).
import type { AggregateIR } from "../../ir/types/loom-ir.js";
import { upperFirst } from "../../util/naming.js";
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
