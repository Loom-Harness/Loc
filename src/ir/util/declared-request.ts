// The declared `command` record that states an aggregate's create request.
//
// The scaffold names it after the create the REST surface routes to: a
// state-based aggregate's canonical create is `Create<Agg>Command`; an
// event-sourced aggregate's is its first `create` action, `<Verb><Agg>Command`.
// A context that declares no such record leaves the request undeclared.

import { upperFirst } from "../../util/naming.js";
import type { AggregateIR, PayloadIR } from "../types/loom-ir.js";

export function declaredCreateCommandFor(
  payloads: readonly PayloadIR[],
  agg: AggregateIR,
): PayloadIR | undefined {
  const es = agg.persistedAs === "eventLog" ? agg.creates[0] : undefined;
  const name = `${es?.name ? upperFirst(es.name) : "Create"}${agg.name}Command`;
  return payloads.find((p) => p.kind === "command" && p.name === name);
}
