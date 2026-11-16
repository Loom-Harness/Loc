// The served aggregate and workflow names a frontend classifies its pages
// against (`classifyPage`), in context order.

import type { FrontendContract } from "../../ir/contract/frontend-contract.js";
import type { PageNameCtx } from "../../ir/util/page-kind.js";
import { clientAggregates } from "./contract.js";

/** The names over a frontend's bounded contexts. */
export function pageNamesOf(
  contexts: Iterable<{
    readonly aggregates: readonly { readonly name: string }[];
    readonly workflows: readonly { readonly name: string }[];
  }>,
): PageNameCtx {
  const list = [...contexts];
  return {
    aggregateNames: [...new Set(list.flatMap((c) => c.aggregates.map((a) => a.name)))],
    workflowNames: list.flatMap((c) => c.workflows.map((w) => w.name)),
  };
}

/** The names over the Frontend Contract, for a frontend serving
 *  `contextNames`: the aggregates a client reads, and the workflows a client starts
 *  or observes (no scaffold page renders any other). */
export function pageNamesOfContract(
  contract: FrontendContract,
  contextNames: readonly string[],
): PageNameCtx {
  const w = contract.wire;
  return {
    aggregateNames: [...new Set(clientAggregates(contract, contextNames).map((a) => a.name))],
    workflowNames: contextNames.flatMap((c) =>
      w.workflows.filter((x) => x.context === c).map((x) => x.name),
    ),
  };
}
