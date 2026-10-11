import type { FieldIR, PrimitiveName, TypeIR } from "../../ir/types/loom-ir.js";

// ---------------------------------------------------------------------------
// The per-backend CHANNEL WIRE-CODEC contract — the `_expr/target.ts` /
// `_numeric/target.ts` shape applied to the broker consumer boundary.
//
// A `LoomEventEnvelope`'s `data` is JSON.  A domain event's fields are NOT:
// a `datetime` is a host instant, a `money` a host decimal, an `X id` a
// branded/wrapped id.  Somewhere between `JSON.parse` and
// `dispatcher.dispatch` those forms have to be RECONCILED, and the field
// list that says how is already in the IR (`EventIR.fields`).
//
// Before this contract existed, four backends had each hand-written that
// reconciliation as a private `decodeExpr(fieldName, TypeIR)`:
//
//   * dotnet  `fromDataExpr`  (emit/channels.ts)
//   * python  `fromPayload`   (dispatch-builder.ts)
//   * elixir  `decodeExpr`    (channels-emit.ts)
//   * java    — delegated wholesale to Jackson `convertValue`
//
// ...and the fifth, node/Hono, had written NONE: its consumer loop spread
// `...envelope.data` into a `DomainEvent` behind a DOUBLE CAST
// (`as unknown as DomainEvent`), which is precisely what stopped TypeScript
// from noticing that `at` was a `string` where the declared field is a
// `Date`.  The event was then dropped at `warn` level in the consuming
// service, on an `ephemeral` channel with no outbox, no retry and no DLQ —
// i.e. silently and permanently (F-019).
//
// Two properties of this seam are the whole point:
//
//  1. **The dispatch is exhaustive.**  `decodeValue` owns the `TypeIR.kind`
//     switch with a `never`-check, so a new IR type kind fails the BUILD.
//     Each of the four private copies instead ended in an anonymous
//     `default:` that treated anything unrecognised as a string — a silent
//     mis-decode by construction.
//  2. **Every passthrough is NAMED.**  A kind that genuinely crosses
//     unchanged for a language routes through `passthrough(expr, t)`
//     rather than falling off the end of a switch, so "this crosses as-is"
//     is a decision a reader can see and a reviewer can challenge.
//
// A backend supplies a `WireDecodeTarget`: a table of leaf render functions,
// one per divergence axis.  Like an `ExprTarget` leaf, a leaf is a pure
// string-in/string-out formatter — it never recurses and never inspects the
// IR, which is what keeps porting an existing hand-written codec onto this
// spine provably byte-identical.
// ---------------------------------------------------------------------------

/** One leaf: render `expr` — source text already known to hold the WIRE
 *  (JSON) form of a value — as the host-language DOMAIN form. */
export type WireDecodeLeaf = (expr: string) => string;

/** A backend's channel wire-decode table.
 *
 *  `primitive` is total over `PrimitiveName` on purpose: adding a primitive
 *  to the language forces every backend to say what its wire form is, rather
 *  than inheriting a `default:` that guesses "string". */
export interface WireDecodeTarget {
  readonly lang: string;
  /** Source expression reading field `field` off the decoded-JSON payload
   *  expression `payload` (`data["at"]`, `payload["at"]`, `data[:at]`, …). */
  read(payload: string, field: string): string;
  primitive: Readonly<Record<PrimitiveName, WireDecodeLeaf>>;
  /** An `X id` — `targetName` is the bare aggregate name (`Job`), NOT
   *  suffixed; the leaf applies the backend's own id-type spelling. */
  id(expr: string, targetName: string): string;
  enumValue(expr: string, name: string): string;
  /** Element-wise collection decode.  `element` renders the decode of ONE
   *  already-read item, given the source text naming that item.  Omitted
   *  when the backend hands the collection across unchanged — which is
   *  correct only while its elements are themselves wire-identical. */
  array?(expr: string, element: (item: string) => string): string;
  /** Present-guard for an optional field: `raw` is the undecoded wire value
   *  (so it can be tested for absence), `decoded` the decode that must only
   *  run when it IS present.  Omitted when the leaves are null-tolerant. */
  optional?(expr: string, decoded: string): string;
  /** The NAMED escape: a value of this IR type crosses UNCHANGED in this
   *  language.  The `TypeIR` is handed over so a leaf can SPELL the host
   *  type (a TS `as` assertion, a C# cast) — never to dispatch on it.  The
   *  dispatch is `decodeValue`'s and stays there; a leaf that switches on
   *  `t.kind` has re-created the private copy this contract replaced. */
  passthrough(expr: string, t: TypeIR): string;
  /** Rebuild a value object from its wire RECORD (a JSON object keyed by the
   *  VO's DSL field names).  `view` turns a wire value known to be such a
   *  record into an expression `read` can index; `build` constructs the host
   *  VO from its fields, each already decoded (declaration order).  Omitted
   *  when the backend's VO crosses untyped (elixir maps) — the value then
   *  takes the named `passthrough`. */
  /** Read an OPTIONAL field off `payload` tolerating its ABSENCE (a producer
   *  may omit a null field) — for a language whose plain `read` throws on a
   *  missing key (C# `GetProperty`, a Python `[...]` subscript).  The result
   *  is what the `optional` leaf tests.  Omitted when `read` already yields
   *  the language's absent value (TS `undefined`, Java `Map.get` null). */
  readOptional?(payload: string, field: string): string;
  valueObject?: {
    view(expr: string): string;
    build(name: string, fields: ReadonlyArray<{ name: string; decoded: string }>): string;
  };
}

/** A value object's declared fields by name — what the dispatcher needs to
 *  rebuild a carried VO field-by-field.  A VO absent from the lookup takes
 *  the named passthrough (never a guess at its shape). */
export type WireValueObjectFields = ReadonlyMap<string, readonly FieldIR[]>;

/** Decode one event field off `payload`, through `target`. */
export function decodeField(
  payload: string,
  field: FieldIR,
  target: WireDecodeTarget,
  vos?: WireValueObjectFields,
): string {
  return decodeValue(readField(payload, field, target), field.type, target, vos);
}

/** The read of one field — absence-tolerant when the field is optional and
 *  the target's plain `read` is not. */
function readField(
  payload: string,
  field: { name: string; type: TypeIR },
  target: WireDecodeTarget,
): string {
  return field.type.kind === "optional" && target.readOptional
    ? target.readOptional(payload, field.name)
    : target.read(payload, field.name);
}

/** Decode a wire value of IR type `t`, through `target`.  Owns the whole
 *  `TypeIR.kind` dispatch and all recursion — a target supplies leaves only. */
export function decodeValue(
  expr: string,
  t: TypeIR,
  target: WireDecodeTarget,
  vos?: WireValueObjectFields,
): string {
  switch (t.kind) {
    case "primitive":
      return target.primitive[t.name](expr);
    case "id":
      return target.id(expr, t.targetName);
    case "enum":
      return target.enumValue(expr, t.name);
    case "optional": {
      const decoded = decodeValue(expr, t.inner, target, vos);
      return target.optional ? target.optional(expr, decoded) : decoded;
    }
    case "array":
      return target.array
        ? target.array(expr, (item) => decodeValue(item, t.element, target, vos))
        : target.passthrough(expr, t);
    // A value object carried on an event: rebuilt field-by-field off its
    // wire record, so a nested `datetime` / `money` / enum / id is decoded
    // exactly as a top-level field would be (eval item 11 — the typed
    // backends handed the raw JSON to the VO-typed constructor parameter).
    case "valueobject": {
      const fields = vos?.get(t.name);
      if (!fields || !target.valueObject) return target.passthrough(expr, t);
      // A self-referential VO (`Node { next: Node? }`) would recurse forever
      // at GENERATE time; below its first level it takes the passthrough.
      const inner = new Map(vos);
      inner.delete(t.name);
      const record = target.valueObject.view(expr);
      return target.valueObject.build(
        t.name,
        fields.map((f) => ({
          name: f.name,
          decoded: decodeValue(readField(record, f, target), f.type, target, inner),
        })),
      );
    }
    // An entity part cannot be an event field type the typed backends build
    // (events carry ids, not parts) — named passthrough, never a guess.
    case "entity":
      return target.passthrough(expr, t);
    // Tagged unions / carrier generics cross as their own JSON shape, and
    // `none` is the unit.  `slot` / `action` are page-only param markers and
    // can never be an event field type at all — they are listed so the
    // `never`-check below stays honest rather than being widened away.
    case "union":
    case "genericInstance":
    case "none":
    case "slot":
    case "action":
      return target.passthrough(expr, t);
    default: {
      const exhaustive: never = t;
      throw new Error(
        `decodeValue (${target.lang}): unhandled TypeIR kind ${(exhaustive as TypeIR).kind}`,
      );
    }
  }
}
