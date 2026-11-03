// Which field defaults .NET cannot carry as a request-record parameter default.
//
// C# requires a record/method parameter default to be a COMPILE-TIME CONSTANT
// (CS1736).  Two lowered default shapes are not:
//
//   * SERVER-SOURCED (`now()` / `currentUser.*`) — `renderCsExpr` yields
//     `DateTime.UtcNow` / an ambient claim read;
//   * a VALUE-OBJECT construction (`total: Money = Money { … }`) — a `new
//     Money(0m, "USD")` constructor call.  It could not name the type there
//     anyway: the request file carries no `Domain.ValueObjects` using;
//   * a LIST LITERAL (`tags: string[] = []`, `codes: string[] = ["a"]`) —
//     `renderCsExpr` yields a collection expression (`[]` / `["a"]`), which is
//     an allocation, not a constant, even when empty.  `IReadOnlyList<T> Tags
//     = []` is CS1736 (#3060's corpus attempt).  In the coalesce it is fine:
//     the other arm (`request.Tags.Select(…).ToList()`) gives the conditional
//     its `List<T>` type, and the collection expression converts to it.
//
// All three take the same escape hatch — the request param becomes NULLABLE with a
// `= null` default, and the controller coalesces the per-request value on the
// way into the command, where the domain namespace IS in scope.
//
// This lives in one place because THREE emitters must agree on it, and a
// disagreement is not a compile error at generation time — it is a compile
// error in the generated project, one tier away:
//
//   1. `cqrs/dtos.ts`      — decides the param is `T? Name = null`
//   2. `cqrs/controller.ts` — emits the `is null ? <default> : <parse>` coalesce
//   3. `validator-emit.ts`  — must then guard its FluentValidation
//      `SetValidator`, because `IValidator<T>` is not `IValidator<T?>` (CS8620)
//
// (3) is the one that bites: it only fails once (1) has already made a
// VO-typed field nullable, so the two features are individually fine and
// jointly broken.  A server-sourced default is never a value object, so this
// combination had no reachable source until VO defaults reached the wire.

import { createOmissionValue } from "../../ir/enrich/wire-projection.js";
import type { AggregateIR, ExprIR, FieldIR } from "../../ir/types/loom-ir.js";
import { isServerSourcedDefault, isValueObjectDefault } from "../_frontend/server-default.js";

/** True when this default cannot be a C# parameter default, so the request
 *  field is emitted nullable and coalesced in the controller.  A type
 *  predicate, so the coalesce site can render the expression without an
 *  assertion. */
export function isNullableWireDefault(e: ExprIR | undefined): e is ExprIR {
  return (
    e !== undefined && (isServerSourcedDefault(e) || isValueObjectDefault(e) || e.kind === "list")
  );
}

/** True when the field is `money` (or `money?`): it crosses the wire as the
 *  RS-12 STRING while its declared literal default lowers to a C# `decimal`
 *  (`0.00m`), which cannot be a `string` parameter default (CS1750). */
function isMoneyField(f: FieldIR): boolean {
  const base = f.type.kind === "optional" ? f.type.inner : f.type;
  return base.kind === "primitive" && base.name === "money";
}

/** Field-level form of {@link isNullableWireDefault}: additionally treats a
 *  defaulted `money` field as non-constant on the wire, so the request param is
 *  `string? Name = null` and the controller coalesces the decimal default. */
export function hasNullableWireDefault(f: FieldIR): boolean {
  return isNullableWireDefault(f.default) || (f.default !== undefined && isMoneyField(f));
}

/** True when a create-request field is a non-nullable collection with no
 *  explicit default: the client may omit it and it initialises to the empty
 *  collection (`createOmissionValue`'s `empty-collection` arm — the .NET twin of
 *  node's create-body `.default([])`).  Like a list-literal default, an empty
 *  collection expression is not a C# parameter-default constant, so the request
 *  field is emitted nullable (`T? Name = null`, no `[Required]`) and the
 *  controller coalesces to `[]`.  An event-sourced aggregate binds its `create`
 *  action's params instead of the field set, and those stay required. */
export function omitsToEmptyCollection(agg: AggregateIR, f: FieldIR): boolean {
  if (agg.persistedAs === "eventLog" && agg.creates?.[0]) return false;
  return createOmissionValue(f).kind === "empty-collection";
}
