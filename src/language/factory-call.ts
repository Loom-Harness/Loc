// The argument mapping of an aggregate factory call `Agg.create(…)`.
//
// A factory call is written in one of three shapes, and all three mean one
// record keyed by field name — the factory's input on every backend:
//
//   Survey.create(e.ticket, e.note)            positional
//   Survey.create(ticket: e.ticket, note: n)   named
//   Survey.create({ ticket: e.ticket, ... })   record
//
// A positional list maps onto the aggregate's create input IN ORDER: the
// parameters of its unnamed `create(…)` when it declares one (they ARE the
// input's fields — `with crudish` synthesizes one from the writable fields),
// else its properties minus the server-owned ones (`managed` / `token` /
// `internal`).  Trailing inputs may be left out; the missing-required-field
// gate decides whether that is allowed.
//
// Shared by the phase-④ argument check (`validators/workflow-create-args.ts`)
// and the workflow lowering (`ir/lower/lower-workflow.ts`), so the order the
// validator accepts is the order the lowering assigns.

import {
  type Aggregate,
  type CallArg,
  type Expression,
  isCreate,
  isObjectLit,
  isProperty,
} from "./generated/ast.js";

const SERVER_OWNED: ReadonlySet<string> = new Set(["managed", "token", "internal"]);

/** The input field names a factory call's positional / named arguments bind
 *  to, in order. */
function factoryInputNames(agg: Aggregate): string[] {
  const declared = agg.members.find((m) => isCreate(m) && !m.name);
  if (declared && isCreate(declared) && declared.params.length > 0) {
    return declared.params.map((p) => p.name);
  }
  const names: string[] = [];
  for (const m of agg.members) {
    if (!isProperty(m)) continue;
    const access = typeof m.access === "string" ? m.access : "";
    if (!SERVER_OWNED.has(access)) names.push(m.name);
  }
  return names;
}

export type FactoryArgs =
  | { kind: "fields"; fields: { name: string; value: Expression }[] }
  | { kind: "mixed" }
  | { kind: "arity"; given: number; inputs: readonly string[] }
  | { kind: "unknown-name"; name: string; inputs: readonly string[] }
  | { kind: "duplicate"; name: string };

/** Map a factory call's arguments onto field names.  The record form (one
 *  positional object literal) maps by its own keys, unchecked here: the
 *  record-key gates own it. */
export function factoryArgs(agg: Aggregate, args: readonly CallArg[]): FactoryArgs {
  const only = args.length === 1 ? args[0] : undefined;
  if (only && !only.name && isObjectLit(only.value)) {
    return {
      kind: "fields",
      fields: only.value.fields.map((f) => ({ name: String(f.name), value: f.value })),
    };
  }
  const inputs = factoryInputNames(agg);
  const named = args.filter((a) => a.name);
  if (named.length > 0 && named.length < args.length) return { kind: "mixed" };
  if (named.length === 0) {
    if (args.length > inputs.length) return { kind: "arity", given: args.length, inputs };
    return { kind: "fields", fields: args.map((a, i) => ({ name: inputs[i]!, value: a.value })) };
  }
  const seen = new Set<string>();
  const fields: { name: string; value: Expression }[] = [];
  for (const a of args) {
    const name = String(a.name);
    if (!inputs.includes(name)) return { kind: "unknown-name", name, inputs };
    if (seen.has(name)) return { kind: "duplicate", name };
    seen.add(name);
    fields.push({ name, value: a.value });
  }
  // Named arguments land in the input's order, like positional ones, so the
  // two spellings of one call are one record.
  fields.sort((x, y) => inputs.indexOf(x.name) - inputs.indexOf(y.name));
  return { kind: "fields", fields };
}
