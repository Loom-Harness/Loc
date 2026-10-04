import type { AggregateIR, ExprIR, FieldIR, TypeIR } from "../../ir/types/loom-ir.js";
import { tryDetectApiHook } from "../_walker/api-hook-detector.js";
import type { MemberReadSpec } from "../_walker/target.js";
import type { WalkContext } from "../_walker/walker-core.js";

// ---------------------------------------------------------------------------
// Optional-receiver member reads for the type-checked frontends.
//
// `p.budget.amount` where the model declares `budget: Budget?` is a NULL
// DEREFERENCE: the wire ships `budget: null` for a project that has none, so
// the read throws at runtime and — on the two frontends whose templates are
// type-checked — fails the build outright (`ng build`'s TS2531 "Object is
// possibly 'null'", svelte-check's "'…' is possibly 'null' or 'undefined'").
// The JS `?.` short-circuit is the whole fix: `p.budget?.amount` is `undefined`
// rather than a throw, and the interpolation renders empty.
//
// Supplied to `WalkerTarget.renderMemberRead`, which the shared walker consults
// before its verbatim `<recv>.<member>` emit.  Only the JS-embedded targets opt
// in: Feliz spells options in F# and its own seam already owns that spelling,
// and a target that omits the seam keeps byte-identical output.
// ---------------------------------------------------------------------------

/** Spell one member read, null-safe when the RECEIVER is optional.  Returns
 *  `undefined` for a non-optional receiver so the caller falls through to the
 *  walker's verbatim emit and every non-optional read stays byte-identical. */
export function optionalChainedMemberRead(spec: MemberReadSpec): string | undefined {
  return receiverIsOptional(spec) ? `${spec.receiver}?.${spec.member}` : undefined;
}

function receiverIsOptional(spec: MemberReadSpec): boolean {
  if (spec.receiverType?.kind === "optional") return true;
  return apiReadFieldType(spec)?.kind === "optional";
}

/** The declared field type behind a member read off an API-READ record —
 *  `<record>.budget`, the shape every scaffolded detail page uses.
 *
 *  Needed because the IR does NOT type a page body's record chain: a QueryView
 *  data lambda's param and an aggregate-rooted read alike fall through
 *  `memberType`'s default, so `receiverType` on the `.amount` node reads
 *  `string` — indistinguishable from a genuine string field.  The walk context
 *  already carries what the IR lost: `paramTypes` names the aggregate a single
 *  record binding holds, `listRowAggregates` the one a row binding holds, and
 *  the api-hook detector recognises a direct `<Agg>.byId(id)` root.  Resolve
 *  the field off the aggregate registry instead of trusting the placeholder.
 *
 *  Returns undefined whenever anything in that chain doesn't resolve, which
 *  leaves the read exactly as it was. */
function apiReadFieldType(spec: MemberReadSpec): TypeIR | undefined {
  const recv = spec.receiverExpr;
  const ctx = spec.ctx;
  if (!recv || !ctx) return undefined;
  return apiReadMemberType(recv, ctx);
}

/** The DECLARED field type behind an api-read member expression — `row.origin`
 *  off a list row, `cargoById.data.lastKnownLocation` off a detail page's
 *  `byId` binding — or `undefined` when the chain resolves to no known
 *  aggregate field.
 *
 *  The public half of the resolution {@link optionalChainedMemberRead}
 *  performs on a read's RECEIVER, exported because the same question — "is the
 *  value this page-body expression reads declared optional?" — is what the
 *  `IdLink` null guard (`_walker/primitives/id-link.ts`) has to answer about a
 *  cross-aggregate reference before it decides whether to emit a link at all.
 *  Answering it off the aggregate registry rather than the IR's `memberType`
 *  is not an optimisation: a page body's record chain is UNTYPED in the IR, so
 *  an optional `Location id?` and a required one both arrive as `string`. */
export function apiReadMemberType(expr: ExprIR, ctx: WalkContext): TypeIR | undefined {
  if (expr.kind !== "member") return undefined;
  const shape = recordShape(expr.receiver, ctx);
  return shape?.fields.find((f) => f.name === expr.member)?.type;
}

/** The declared field list a record-valued page-body expression reads off —
 *  an AGGREGATE's, or a contained entity PART's.
 *
 *  The part half is F-021.  A detail page's containment table walks
 *  `Table(rows: noteById.data.lines, …)`, so every cell's row binding holds a
 *  `NoteLine`, not a `Note` — and a part is not in `ctx.aggregatesByName` at
 *  all (that registry is aggregates only, and widening it would change what
 *  `CreateForm(of:)` / `IdLink(of:)` resolve).  Resolving nothing reads as
 *  "required" downstream, which is how an OPTIONAL `tag: Tag id?` in a
 *  containment row reached the pack as an unguarded `IdLink`: react, svelte and
 *  angular linked to `/tags/null`, and Vue failed `vue-tsc` outright on
 *  `:title="row.tag"` (`string | null | undefined` vs `RouterLinkProps`) — the
 *  six-way split `_walker/primitives/id-link.ts`'s own header documents, for a
 *  guard that simply never fired.
 *
 *  Parts are addressed by the QUALIFIED key `"<Aggregate>.<Part>"` rather than
 *  a bare part name: part types are aggregate-scoped in the language (the scope
 *  provider restricts a containment's partType to the declaring aggregate), so
 *  two aggregates may each own a `Line`, and a bare name would silently resolve
 *  to whichever was found first. */
export type RowShape = { readonly name: string; readonly fields: readonly FieldIR[] };

/** Resolve a row key — `"Note"` or the qualified `"Note.NoteLine"` — to the
 *  shape whose fields the row's cells read. */
export function rowShapeByKey(key: string | undefined, ctx: WalkContext): RowShape | undefined {
  if (key === undefined) return undefined;
  const dot = key.indexOf(".");
  if (dot === -1) {
    const agg = ctx.aggregatesByName.get(key);
    return agg ? { name: agg.name, fields: agg.fields } : undefined;
  }
  const agg = ctx.aggregatesByName.get(key.slice(0, dot));
  const part = agg?.parts.find((p) => p.name === key.slice(dot + 1));
  return part ? { name: part.name, fields: part.fields } : undefined;
}

/** The row key a CONTAINMENT read yields rows of — `noteById.data.lines` →
 *  `"Note.NoteLine"` — or undefined when the receiver is not a record of a
 *  known aggregate or the member is not one of its containments. */
export function containmentRowKey(expr: ExprIR, ctx: WalkContext): string | undefined {
  if (expr.kind !== "member") return undefined;
  const owner = recordAggregate(expr.receiver, ctx);
  const contained = owner?.contains.find((c) => c.name === expr.member);
  return owner && contained ? `${owner.name}.${contained.partName}` : undefined;
}

/** The shape an expression evaluates to ONE RECORD of, or undefined. */
function recordShape(expr: ExprIR, ctx: WalkContext): RowShape | undefined {
  if (expr.kind === "ref") {
    return (
      rowShapeByKey(ctx.paramTypes?.get(expr.name), ctx) ??
      rowShapeByKey(ctx.listRowAggregates?.get(expr.name), ctx)
    );
  }
  const agg = recordAggregate(expr, ctx);
  return agg ? { name: agg.name, fields: agg.fields } : undefined;
}

/** The AGGREGATE an expression evaluates to one record of, or undefined.
 *  Narrower than {@link recordShape} on purpose: a containment's OWNER has to
 *  be a real aggregate (a part cannot be the root of an api hook), and the
 *  `contains` list only exists there. */
function recordAggregate(expr: ExprIR, ctx: WalkContext): AggregateIR | undefined {
  const named = (name: string | undefined): AggregateIR | undefined =>
    name === undefined ? undefined : ctx.aggregatesByName.get(name);
  if (expr.kind === "ref") {
    return named(ctx.paramTypes?.get(expr.name)) ?? named(ctx.listRowAggregates?.get(expr.name));
  }
  const detected = tryDetectApiHook(expr, ctx);
  return detected?.kind === "aggregate" ? named(detected.aggregateName) : undefined;
}
