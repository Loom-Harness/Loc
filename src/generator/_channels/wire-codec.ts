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
}

/** Decode one event field off `payload`, through `target`. */
export function decodeField(payload: string, field: FieldIR, target: WireDecodeTarget): string {
  return decodeValue(target.read(payload, field.name), field.type, target);
}

/** Decode a wire value of IR type `t`, through `target`.  Owns the whole
 *  `TypeIR.kind` dispatch and all recursion — a target supplies leaves only. */
export function decodeValue(expr: string, t: TypeIR, target: WireDecodeTarget): string {
  switch (t.kind) {
    case "primitive":
      return target.primitive[t.name](expr);
    case "id":
      return target.id(expr, t.targetName);
    case "enum":
      return target.enumValue(expr, t.name);
    case "optional": {
      const decoded = decodeValue(expr, t.inner, target);
      return target.optional ? target.optional(expr, decoded) : decoded;
    }
    case "array":
      return target.array
        ? target.array(expr, (item) => decodeValue(item, t.element, target))
        : target.passthrough(expr, t);
    // A value object / entity part carried on an event.  Reconstructing one
    // field-by-field needs the referenced record's OWN field list, which the
    // channel emitters are not handed today (and which, for a FOREIGN event,
    // is not even merged into the consuming deployable — its
    // `domain/value-objects` module comes out EMPTY while the event module
    // imports from it, so that model does not compile at all).  This routes
    // through the NAMED passthrough rather than a silent `default:` — so a
    // nested `datetime`/`money` inside a carried record is a known, visible
    // gap with one place to close it, not an accident of switch fall-through.
    case "valueobject":
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

/** True when a decode of `t` is anything other than the identity — i.e. the
 *  JSON form and the host form genuinely differ somewhere inside it.  Lets a
 *  caller keep an all-identity emission byte-identical with the pre-codec
 *  output instead of wrapping every field in a no-op. */
export function needsDecode(t: TypeIR, target: WireDecodeTarget): boolean {
  const probe = "__x";
  return decodeValue(probe, t, target) !== probe;
}
