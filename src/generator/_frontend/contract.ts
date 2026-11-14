import type { FrontendContract } from "../../ir/contract/frontend-contract.js";
import type { TypeIR } from "../../ir/types/loom-ir.js";

/** The Frontend Contract a frontend generation reads.  Every caller — the
 *  system orchestrator through `emitProject`, and a backend embedding the
 *  bundle — passes it; a generation without one is a wiring defect. */
export function requireFrontendContract(
  contract: FrontendContract | undefined,
  deployableName: string,
): FrontendContract {
  if (!contract) {
    throw new Error(
      `Frontend deployable '${deployableName}' was generated without the system's Frontend Contract; the caller must pass \`frontendContract\`.`,
    );
  }
  return contract;
}

/** A repository find as a client calls it: the contract's find, with the route
 *  the target backend serves it on. */
export interface ClientFind {
  name: string;
  params: readonly { name: string; type: TypeIR }[];
  returnType: TypeIR;
  sortDefault?: string;
  /** The served route, on a synthesized find; the auto-`all` has none. */
  path?: string;
}

/** `aggregate`'s finds a client served by `serves` can call: the auto-`all`,
 *  and each synthesized find routed on one of those apis — the first route in
 *  `serves` order, then declaration order. */
export function clientFinds(
  contract: FrontendContract,
  aggregate: string,
  serves: readonly string[],
): ClientFind[] {
  const out: ClientFind[] = [];
  for (const f of contract.wire.finds) {
    if (f.aggregate !== aggregate) continue;
    const base = {
      name: f.name,
      params: f.params,
      returnType: f.returnType,
      ...(f.sortDefault !== undefined ? { sortDefault: f.sortDefault } : {}),
    };
    if (f.name === "all") {
      out.push(base);
      continue;
    }
    const route = serves
      .map((api) => f.routes?.find((r) => r.api === api))
      .find((r) => r !== undefined);
    if (route) out.push({ ...base, path: route.path });
  }
  return out;
}

/** Whether `aggregate` serves its entity-history trail. */
export function servesHistory(contract: FrontendContract, aggregate: string): boolean {
  return contract.wire.aggregates.some((a) => a.name === aggregate && a.history === true);
}
