// The declared `command` / `query` record that states a derived route's
// request.
//
// The scaffold (`_handlers-shared.ts`) names each record after the handler
// that serves the route, and the IR reads it back by the same name, because a
// derived route keeps no link to the record lowering could follow:
//   - create    → `Create<Agg>Command`; an event-sourced aggregate's is its
//                 first `create` action, `<Verb><Agg>Command`;
//   - operation → `<Op><Agg>Command`;
//   - destroy   → `Destroy<Agg>Command`;
//   - get-by-id → `Get<Agg>ByIdQuery`.
// A context that declares no such record leaves the request undeclared.
// `test/macro/scaffold-record-names-census.test.ts` holds the two spellings
// together.

import { upperFirst } from "../../util/naming.js";
import type { AggregateIR, PayloadIR } from "../types/loom-ir.js";
import type { ApiOperationIR } from "./api-surface.js";

export function declaredCreateCommandFor(
  payloads: readonly PayloadIR[],
  agg: AggregateIR,
): PayloadIR | undefined {
  const name = createCommandName(agg);
  return payloads.find((p) => p.kind === "command" && p.name === name);
}

function createCommandName(agg: AggregateIR): string {
  const es = agg.persistedAs === "eventLog" ? agg.creates[0] : undefined;
  return `${es?.name ? upperFirst(es.name) : "Create"}${agg.name}Command`;
}

/** The declared record carrying a derived operation's request, or undefined
 *  for a kind the scaffold declares none for (a find, a permission probe) or
 *  a context that declares none. */
export function declaredRequestFor(
  payloads: readonly PayloadIR[],
  aggs: readonly AggregateIR[],
  op: ApiOperationIR,
): PayloadIR | undefined {
  const agg = aggs.find((a) => a.name === op.aggregate);
  if (!agg) return undefined;
  const named = (kind: "command" | "query", name: string) =>
    payloads.find((p) => p.kind === kind && p.name === name);
  switch (op.kind) {
    case "create":
      return declaredCreateCommandFor(payloads, agg);
    case "operation":
      return op.operation
        ? named("command", `${upperFirst(op.operation.name)}${agg.name}Command`)
        : undefined;
    case "destroy":
      return named("command", `Destroy${agg.name}Command`);
    case "getById":
      return named("query", `Get${agg.name}ByIdQuery`);
    case "find":
    case "gateProbe":
      return undefined;
  }
}
