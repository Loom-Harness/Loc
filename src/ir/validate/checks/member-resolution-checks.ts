// ---------------------------------------------------------------------------
// `loom.member-unresolved` — the IR-side backstop for a member read the
// language layer never checked.
//
// The lowerer types a member read by looking the name up on the receiver's
// declared shape (`memberType`, `src/ir/lower/lower-expr.ts`). When the name
// isn't there, it falls back to `string`: the IR's equivalent of the language
// layer's `unknown`. Every source-written invented member is supposed to be
// refused earlier, by the AST validator. That refusal only runs when the
// LANGUAGE type system can type the receiver, and wherever it can't (an
// env-poor `let`, a collection op's element, ...) the receiver types as
// `unknown`. Every downstream check stands down there (the M-T5.16 cascade),
// so the invented member lowers to a `string`, passes validation, and reaches
// the generated code verbatim:
//
//     let xs = [this.addr]
//     title := xs.first().nope        // ddd parse: 0 error(s)
//     →  this._title = (…)[0].nope;   // node; python / elixir don't even fail to compile
//
// The IR doesn't have that poverty: every `member` node carries the
// receiver's resolved `receiverType`. So the check runs again here, against
// the IR's own record of each named shape, over every expression the model
// holds (`forEachModelExpr`). The pipeline FAILS CLOSED on the case the
// language layer can't see, and doesn't depend on every `envForNode` binder
// being typed (#3125 / #3130 work on that side).
//
// Deliberately CONSERVATIVE: it only fires when the receiver names a shape the
// IR actually knows (aggregate / part / value object / event / payload /
// workflow state / projection row). A name declared by several shapes counts
// as its members' UNION, so the only thing refused is a member that NO
// candidate declares. Primitive receivers are out of scope here: that is
// `loom.unknown-primitive-member`'s ground (#2949).
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import {
  allContexts,
  type EnrichedLoomModel,
  type ExprIR,
  type TypeIR,
} from "../../types/loom-ir.js";
import { forEachModelExpr } from "../../util/model-exprs.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** The synthetic `currentUser` shape. Its members are `user {}` claims, which
 *  the AST validator checks (`loom.unknown-user-claim`) and phase ⑥ rebinds. */
const USER_SHAPE_NAME = "__User__";

type ShapeIndex = Map<string, Set<string>>;

function add(index: ShapeIndex, name: string, members: Iterable<string>): void {
  let set = index.get(name);
  if (!set) {
    set = new Set();
    index.set(name, set);
  }
  for (const m of members) set.add(m);
}

const names = (xs: readonly { name: string }[] | undefined): string[] =>
  (xs ?? []).map((x) => x.name);

/** Every named shape a member read can land on, keyed by name. */
function buildShapeIndex(loom: EnrichedLoomModel): ShapeIndex {
  const index: ShapeIndex = new Map();
  for (const vo of loom.rootValueObjects)
    add(index, vo.name, [...names(vo.fields), ...names(vo.derived)]);
  for (const ctx of allContexts(loom)) {
    for (const agg of ctx.aggregates) {
      add(index, agg.name, [
        "id",
        ...names(agg.fields),
        ...names(agg.contains),
        ...names(agg.derived),
      ]);
      for (const part of agg.parts) {
        add(index, part.name, [
          "id",
          ...names(part.fields),
          ...names(part.contains),
          ...names(part.derived),
        ]);
      }
    }
    for (const vo of ctx.valueObjects)
      add(index, vo.name, [...names(vo.fields), ...names(vo.derived)]);
    for (const ev of ctx.events) add(index, ev.name, names(ev.fields));
    for (const p of ctx.payloads) add(index, p.name, names(p.fields));
    for (const wf of ctx.workflows) add(index, wf.name, names(wf.stateFields));
    for (const proj of ctx.projections) add(index, proj.name, names(proj.stateFields));
  }
  return index;
}

/** The shape name a member read resolves against, or `undefined` when the
 *  receiver isn't a named shape this check knows (primitives, unions, ...). */
function shapeNameOf(t: TypeIR): string | undefined {
  switch (t.kind) {
    case "optional":
      return shapeNameOf(t.inner);
    case "entity":
    case "valueobject":
      return t.name;
    case "id":
      return t.targetName;
    default:
      return undefined;
  }
}

export function validateMemberResolution(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  const index = buildShapeIndex(loom);
  const seen = new Set<string>();
  forEachModelExpr(loom, ({ expr, source }) => {
    const e: ExprIR = expr;
    if (e.kind !== "member") return;
    const shape = shapeNameOf(e.receiverType);
    if (!shape || shape === USER_SHAPE_NAME) return;
    const members = index.get(shape);
    if (!members || members.has(e.member)) return;
    // One report per (site, shape, member): the same read can be visited
    // through two enumerations of one site (e.g. a derived on both sides).
    const key = `${source}\u0000${shape}\u0000${e.member}`;
    if (seen.has(key)) return;
    seen.add(key);
    diags.push({
      severity: "error",
      code: "loom.member-unresolved",
      message: diagMessage("loom.member-unresolved", {
        member: e.member,
        shape,
        known: [...members].sort().join(", "),
      }),
      source,
    });
  });
}
