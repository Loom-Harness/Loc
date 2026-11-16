// The project-wide usage flags a frontend gates a runtime on, read off the
// Frontend Contract: whether money reaches the client (the `decimal.js`
// dependency and the `moneySchema` helper) and whether a provenanced field
// does (the lineage schema).  The client only ever holds what the wire and its
// own ui carry, so the flags are decided over those types.

import type { FrontendContract } from "../../ir/contract/frontend-contract.js";
import { type TypeIR, typeUsesMoney } from "../../ir/types/loom-ir.js";
import { clientAggregates } from "./contract.js";

/** Every wire type a client of `contextNames` holds. */
function clientTypes(contract: FrontendContract, contextNames: readonly string[]): TypeIR[] {
  const served = new Set(contextNames);
  const w = contract.wire;
  const entities = new Set(
    clientAggregates(contract, contextNames).flatMap((a) => [a.name, ...(a.parts ?? [])]),
  );
  const fields = (list: readonly { fields: readonly { type: TypeIR }[] }[]) =>
    list.flatMap((r) => r.fields.map((f) => f.type));
  return [
    ...fields(w.responses.filter((r) => entities.has(r.entity))),
    ...fields(w.records.filter((r) => r.context !== undefined && served.has(r.context))),
    ...fields(w.events.filter((r) => r.context !== undefined && served.has(r.context))),
    ...fields(w.valueObjects.filter((v) => v.context !== undefined && served.has(v.context))),
    ...fields(w.projections.filter((p) => served.has(p.context))),
    ...w.workflows
      .filter((x) => served.has(x.context))
      .flatMap((x) => [...(x.params ?? []), ...(x.instance ?? [])].map((f) => f.type)),
  ];
}

/** Money reaches a client of `contextNames` over the wire. */
export function contractUsesMoney(
  contract: FrontendContract,
  contextNames: readonly string[],
): boolean {
  return clientTypes(contract, contextNames).some(typeUsesMoney);
}

/** A response a client of `contextNames` reads carries a provenanced field. */
export function contractUsesProvenance(
  contract: FrontendContract,
  contextNames: readonly string[],
): boolean {
  const entities = new Set(
    clientAggregates(contract, contextNames).flatMap((a) => [a.name, ...(a.parts ?? [])]),
  );
  return contract.wire.responses.some(
    (r) => entities.has(r.entity) && r.fields.some((f) => f.provenanced),
  );
}
