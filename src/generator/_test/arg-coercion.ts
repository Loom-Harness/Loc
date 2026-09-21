import type { ExprIR, IdValueType, TypeIR } from "../../ir/types/loom-ir.js";

// ---------------------------------------------------------------------------
// The ONE rule deciding whether a literal written in a `test` body needs
// coercing to the strong type its position declares — and to which coercion.
//
// A `test` block is user-written `.ddd` source, so an `<Agg> id` or `datetime`
// position is spelled as a bare string literal:
//
//     operation assign(owner: Owner id) { ownerId := owner }
//     test "…" { w.assign("00000000-0000-0000-0000-000000000001") }
//
// Every backend's domain surface takes a STRONG type there (`OwnerId` brand /
// `Date` / `datetime` / `Instant` / `CustomerId` record), so the raw literal
// must be wrapped at the call site.  Skipping it is invisible to the
// behavioral tier — vitest and pytest do not typecheck — and only surfaces in
// the user's own `npm run typecheck` / `mypy --strict`, which is also the
// shape of the generated project's own `build` script.  Worse for `datetime`:
// the value STORED in the aggregate is a string where the field is a date.
//
// This module owns the DECISION (read off the IR type + the argument expr);
// each backend supplies only the rendering leaves, the same
// contract-plus-leaf-table shape as `_expr/target.ts` and `_type/target.ts`.
// It is the single rule behind BOTH literal positions — an operation-call
// argument and a `create({ … })` create-input field.
// ---------------------------------------------------------------------------

/** What coercion a literal in a typed position needs, if any. */
export type LiteralCoercion =
  | { kind: "id"; targetName: string; valueType: IdValueType }
  | { kind: "datetime" }
  | { kind: "none" };

/** Decide the coercion for `value` written in a position declared `type`.
 *
 *  Only a raw STRING literal is ever coerced.  Everything else already renders
 *  at the target type and wrapping it would BREAK the emission: `now` renders
 *  as `Instant.now()` / `DateTime.UtcNow` / `datetime.now(UTC)`, a `ref` to a
 *  let-binding or parameter is already branded, and an `int`-valued id renders
 *  as a number.  That guard is the rule's load-bearing half — it is why this
 *  is a decision function and not a type lookup. */
export function decideLiteralCoercion(type: TypeIR | undefined, value: ExprIR): LiteralCoercion {
  if (value.kind !== "literal" || value.lit !== "string") return { kind: "none" };
  // An OPTIONAL position (`ownerId: Owner id?`, `scheduledAt: datetime?`) is
  // still that position: `X?` reaches the create input / parameter as
  // `XId | undefined`, so a bare literal there needs the SAME wrap.  Unwrapping
  // here is what makes the rule reach optional fields — the create-input path
  // matched on the bare `kind` before, so an optional `X id` silently passed
  // the literal through and the generated project failed with TS2322.
  const t = type?.kind === "optional" ? type.inner : type;
  if (t?.kind === "id") {
    return { kind: "id", targetName: t.targetName, valueType: t.valueType };
  }
  if (t?.kind === "primitive" && t.name === "datetime") return { kind: "datetime" };
  return { kind: "none" };
}

/** Per-backend rendering leaves.  `rendered` is the argument already rendered
 *  by the backend's own expression renderer (so escaping/quoting stays that
 *  backend's business); each leaf wraps it in the target-language constructor. */
export interface TestLiteralTarget {
  /** `"…"` in an `<Agg> id` position → the backend's brand / id constructor. */
  id(rendered: string, targetName: string, valueType: IdValueType): string;
  /** `"…"` (ISO-8601) in a `datetime` position → the backend's date type. */
  datetime(rendered: string): string;
}

/** Apply the decided coercion through a backend's leaf table.  Returns
 *  `rendered` unchanged when no coercion applies. */
export function coerceTestLiteral(
  type: TypeIR | undefined,
  value: ExprIR,
  rendered: string,
  target: TestLiteralTarget,
): string {
  const c = decideLiteralCoercion(type, value);
  if (c.kind === "id") return target.id(rendered, c.targetName, c.valueType);
  if (c.kind === "datetime") return target.datetime(rendered);
  return rendered;
}

/** Coerce a positional argument list against a parameter list — the
 *  operation-call half of the rule, shared by every backend's test emitter.
 *  `renderArg` is the backend's own renderer for one argument expression. */
export function coerceTestArgs(
  params: readonly { type: TypeIR }[] | undefined,
  args: readonly ExprIR[],
  renderArg: (a: ExprIR, index: number) => string,
  target: TestLiteralTarget,
): string[] {
  return args.map((a, i) => coerceTestLiteral(params?.[i]?.type, a, renderArg(a, i), target));
}
