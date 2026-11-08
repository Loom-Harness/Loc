// The JSON kind each storable primitive crosses the wire as.
//
// A pure-data mirror of `wire.json` in the codec table
// (`src/ir/enrich/codec.ts`, `SCALARS`), homed in `util/` because the typing
// pass — upstream of the IR — reads it to type a `test e2e` client value as
// the JSON the backend sends: a `money` field is a fixed-scale STRING there,
// a `datetime` an ISO string, an id a uuid string.  The codec stays the
// authority; `test/ir/scalar-wire-json-parity.test.ts` pins every row to it,
// so the mirror cannot drift.

import type { PrimitiveName } from "../ir/types/loom-ir.js";

/** The JSON value kind a primitive is carried as. */
export type WireJson = "string" | "number" | "boolean" | "any" | "object";

/** Every storable primitive (`duration` is expression-only and never crosses
 *  the wire) → its JSON kind. */
export const SCALAR_WIRE_JSON: Readonly<Record<Exclude<PrimitiveName, "duration">, WireJson>> = {
  int: "number",
  long: "number",
  decimal: "number",
  money: "string",
  string: "string",
  bool: "boolean",
  date: "string",
  datetime: "string",
  guid: "string",
  json: "any",
  File: "object",
};
