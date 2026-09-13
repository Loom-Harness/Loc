// IdLink(<id-expr>, of: <Agg>) — the cross-aggregate reference link, wrapped in
// a NULL GUARD when the reference it links to is optional (M-T1.33, #2864 T4).
//
// A `lastKnownLocation: Location id?` field is ordinary domain modelling — "we
// don't know where the cargo is yet" — and the wire ships `null` for it.  The
// link markup every pack builds is a string CONCATENATION over that value
// (`"/locations/" + <id>`), and unguarded it fails differently on each of the
// six frontends, twice fatally:
//
//   vue      `:title="row.lastKnownLocation"`   → vue-tsc TS2345, build fails
//   feliz    `("/locations/" + <string option>)` → F# type error, build fails
//   react    `` to={`/locations/${…}`} ``        → links to `/locations/null`
//   svelte   `` href={`/locations/${…}`} ``      → links to `/locations/null`
//   angular  `[routerLink]='"/locations/" + …'`  → links to `/locations/null`
//   flutter  `'/locations/' + ….toString()`      → `/locations/null`, label "null"
//
// The guard is the whole fix, and it is one decision applied six ways: an
// ABSENT reference renders a plain em dash and no link at all — the same
// placeholder `FileLink` (`file-link.ts`) already established for an unset
// `File?`, and the one the Flutter pack already applies to a null `datetime` or
// `money`.  The wire shape is untouched; this is a rendering decision only.
//
// This module OWNS the registry's `IdLink` entry and delegates the link markup
// itself, unchanged, to the pack-contract emitter in `primitives/controls.ts`.
// A REQUIRED reference never reaches the guard and stays byte-identical.

import type { ExprIR } from "../../../ir/types/loom-ir.js";
import { apiReadMemberType } from "../../_frontend/optional-member.js";
import { namedArgValue, positionalArgs } from "../shared/args.js";
import type { WalkContext } from "../walker-core.js";
import { emitExpr, extendLambdaParams, propagateChildFlags } from "../walker-core.js";
import { emitIdLink as emitIdLinkUnguarded } from "./controls.js";

/** The local an unwrapped optional id binds to on the two targets that must
 *  BIND to unwrap (`renderOptionalSplit`).  Double-underscored like the
 *  walker's other synthetic locals (`__f` in `FileLink`, `__p` in
 *  `ProvenanceInfo`) so it cannot collide with a user-authored name. */
const BOUND_ID = "__id";

/** The source name the rebound id argument is written as.  Never appears in
 *  output — `lambdaParams` maps it to {@link BOUND_ID} — but it must not
 *  collide with a real page-body binding, hence the sigil. */
const REBOUND_SRC = "$loomOptionalId";

/** `IdLink(<id>, of: <Agg>)` — the reference link, null-guarded when the
 *  reference is optional. */
export function emitIdLink(
  call: ExprIR & { kind: "call" },
  ctx: WalkContext,
  depth: number,
): string {
  const idArg = namedArgValue(call, "id") ?? positionalArgs(call)[0];
  // A required reference — the overwhelmingly common case — takes the emitter
  // it always took, with the argument it always had.  Nothing about its output
  // changes, which is what keeps every committed frontend golden green.
  if (!idArg || !isOptionalReference(idArg, ctx)) {
    return emitIdLinkUnguarded(call, ctx, depth);
  }

  const valueExpr = emitExpr(idArg, ctx);

  // --- The two binding targets (Feliz, Flutter) ---------------------------
  //
  // Their languages cannot test an optional for truthiness AND cannot
  // concatenate it once tested, so the link has to be rendered over an
  // unwrapped LOCAL.  Rather than hand the pack template a hand-built
  // expression — which would fork the markup and quietly strip the pack of
  // ownership of its own link — the id ARGUMENT is rebound: a synthetic ref
  // that `lambdaParams` resolves to `__id`, walked through the ordinary
  // emitter, so the pack renders exactly the link it always renders, just over
  // a different name.
  if (ctx.target.renderOptionalSplit) {
    const bound: WalkContext = {
      ...ctx,
      lambdaParams: extendLambdaParams(ctx, REBOUND_SRC, BOUND_ID),
    };
    const present = emitIdLinkUnguarded(withReboundId(call, idArg), bound, depth);
    // The spread above gave the sub-context its own copies of the scalar `uses*`
    // flags, and `emitIdLink` sets `usesRouterLink` on whichever context it is
    // handed.  Without this the page would render a `RouterLink` it never
    // imported — the same propagation every other sub-scope walk performs.
    propagateChildFlags(ctx, bound);
    return ctx.target.renderOptionalSplit({ value: valueExpr, bound: BOUND_ID, present });
  }

  // --- The JS/markup family (React, Vue, Svelte, Angular) ------------------
  //
  // The optional expression IS the condition, and TypeScript narrows it to the
  // non-null type inside the true arm, so the link renders over the original
  // expression with no rebinding — and `renderConditionalChild` already spells
  // the split four ways (JSX ternary, `v-if`, `{#if}`, `@if`).
  const link = emitIdLinkUnguarded(call, ctx, depth);
  // A bare `<span>` — plain markup that is valid in every one of these targets'
  // conditional-child arms, and what `FileLink` puts its own em dash in.
  const dash = `<span>${ctx.target.escapeText("—")}</span>`;
  return ctx.target.renderConditionalChild(valueExpr, link, dash, depth);
}

/** Whether the expression an `IdLink` links FROM reads a field the model
 *  declares optional.
 *
 *  The IR cannot be asked directly: a page body's record chain is untyped, so
 *  `row.lastKnownLocation` and `row.origin` both carry the same placeholder
 *  `string`.  `apiReadMemberType` re-resolves the field off the walk context's
 *  aggregate registry, which is where the `?` actually survives.  Anything that
 *  does not resolve to a declared field — a route param, a `let`, a literal —
 *  is treated as required, so an unresolvable chain degrades to exactly the
 *  output this primitive emitted before the guard existed. */
function isOptionalReference(idArg: ExprIR, ctx: WalkContext): boolean {
  return apiReadMemberType(idArg, ctx)?.kind === "optional";
}

/** The same `IdLink` call with its id argument replaced by a ref to
 *  {@link REBOUND_SRC}, leaving `of:` and every display arg (`testid`,
 *  `style`) exactly where they were — argument POSITION carries meaning here
 *  (`positionalArgs` picks the first unnamed one), so the arrays are rewritten
 *  in place rather than rebuilt. */
function withReboundId(call: ExprIR & { kind: "call" }, idArg: ExprIR): ExprIR & { kind: "call" } {
  const rebound: ExprIR = { kind: "ref", name: REBOUND_SRC, refKind: "let" };
  return { ...call, args: call.args.map((a) => (a === idArg ? rebound : a)) };
}
