// Which params of a command entry point bear a value object.
//
// A value object's rules are judged at the WIRE on every command entry point —
// an aggregate create, an operation, a workflow `create` — before the body
// runs: a breach is the 422 at `/<param>/<member>`, never the domain-floor
// refusal the value object's constructor raises once the body builds it.  Each
// backend spells the judgement its own way (a zod schema, a pydantic model, a
// FluentValidation validator, a Spring `Validator`, an Ecto changeset); which
// params need it is this one decision.  A param bears a value object when its
// type is one, `T?` and `T[]` unwrapped — a list is judged element by element.

import type { TypeIR } from "../types/loom-ir.js";

/** The value object a type bears, `T?` / `T[]` unwrapped, with `each` set when
 *  it is a collection (judged per element).  `null` when it bears none. */
export function valueObjectBorne(type: TypeIR): { name: string; each: boolean } | null {
  switch (type.kind) {
    case "valueobject":
      return { name: type.name, each: false };
    case "array": {
      const e = valueObjectBorne(type.element);
      return e ? { name: e.name, each: true } : null;
    }
    case "optional":
      return valueObjectBorne(type.inner);
    default:
      return null;
  }
}

/** Every param of an entry point that bears a value object, in declaration
 *  order — the params whose value-object rules a backend judges at the wire. */
export function valueObjectParams<P extends { name: string; type: TypeIR }>(
  params: readonly P[],
): { param: P; vo: string; each: boolean }[] {
  const out: { param: P; vo: string; each: boolean }[] = [];
  for (const param of params) {
    const borne = valueObjectBorne(param.type);
    if (borne) out.push({ param, vo: borne.name, each: borne.each });
  }
  return out;
}
