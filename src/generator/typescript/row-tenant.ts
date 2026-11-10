// Events raised on a `tenantOwned` row carry the ROW's tenant
// (`eventsCarryRowTenant`): a state save records its outbox rows and dispatches
// its events inside `runInRowTenant(aggregate.tenantId, …)`, which keeps the
// request's frame when the tenants agree and otherwise opens the row tenant's
// event-origin frame.

import type { AggregateIR } from "../../ir/types/loom-ir.js";
import { eventsCarryRowTenant } from "../../ir/util/tenant-stance.js";
import { T } from "./ts-symbols.js";

/** `call` (an awaitable expression), run in `agg`'s row-tenant frame when its
 *  events must carry the row's tenant; `call` unchanged otherwise. */
export function inRowTenant(
  agg: Pick<AggregateIR, "capabilities" | "persistedAs">,
  call: string,
): string {
  return eventsCarryRowTenant(agg)
    ? `${T.runInRowTenant}(aggregate.tenantId, async () => ${call})`
    : call;
}
