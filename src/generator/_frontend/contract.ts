import type {
  ContractAggregate,
  ContractProjection,
  ContractWorkflow,
  FrontendContract,
} from "../../ir/contract/frontend-contract.js";
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

/** The aggregates a client of `contextNames` reads, in context order: each
 *  with a declared response (an abstract base serves rows only as the
 *  polymorphic read home, which has one). */
export function clientAggregates(
  contract: FrontendContract,
  contextNames: readonly string[],
): ContractAggregate[] {
  const withResponse = new Set(contract.wire.responses.map((r) => r.entity));
  return contextNames.flatMap((c) =>
    contract.wire.aggregates.filter((a) => a.context === c && withResponse.has(a.name)),
  );
}

/** The workflows a client of `contexts` starts or observes, by name. */
export function clientWorkflows(
  contract: FrontendContract,
  contexts: Iterable<string>,
): ContractWorkflow[] {
  const served = new Set(contexts);
  return contract.wire.workflows.filter((w) => served.has(w.context));
}

/** The projections a client of `contexts` reads, in declaration order. */
export function clientProjections(
  contract: FrontendContract,
  contexts: Iterable<string>,
): ContractProjection[] {
  const served = new Set(contexts);
  return contract.wire.projections.filter((p) => served.has(p.context));
}

/** The contract's ui half as the walker reads it.  The contract is JSON-exact,
 *  so a positional argument's slot in a call's `argNames` is `null` there; the
 *  walker reads a positional slot as `undefined`, as the lowering leaves it. */
export function contractUiOf(contract: FrontendContract): FrontendContract["ui"] {
  const decode = (x: unknown): unknown => {
    if (Array.isArray(x)) return x.map(decode);
    if (x === null || typeof x !== "object") return x;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(x)) {
      out[k] =
        k === "argNames" && Array.isArray(v)
          ? v.map((n) => (n === null ? undefined : n))
          : decode(v);
    }
    return out;
  };
  return decode(contract.ui) as FrontendContract["ui"];
}
