// React api module — read-only workflow-instance query hooks
// (workflow-instance-visibility.md): an observable workflow gets
// `useAll<Wf>Instances()` / `use<Wf>InstanceById(id)` + the matching Zod
// response schemas in src/api/workflows.ts, mirroring an aggregate's
// `useAll<Agg>` / `use<Agg>ById`.

import { describe, expect, it } from "vitest";
import { buildWorkflowsApiModule } from "../../../src/generator/_frontend/workflows-module.js";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { allContexts } from "../../../src/ir/types/loom-ir.js";
import { parseString } from "../../_helpers/index.js";

const SAGA = `
  system S { subdomain M { context C {
    aggregate Order { total: int }
    enum FulfillmentStatus { Pending, Shipped }
    event PaymentReceived { order: Order id, amount: int }
    workflow Fulfillment {
      orderId: Order id
      status: FulfillmentStatus
      create(paid: PaymentReceived) by paid.order { let x = paid.amount }
    }
  }}}`;

const COMMAND_ONLY = `
  system S { subdomain M { context C {
    aggregate Order { total: int }
    workflow placeOrder transactional {
      create(total: int) { let o = Order.create({ total: total }) }
    }
  }}}`;

async function apiModule(srcText: string): Promise<string> {
  const { model } = await parseString(srcText, { validate: false });
  return buildWorkflowsApiModule(allContexts(enrichLoomModel(lowerModel(model))));
}

describe("React workflows api module — instance hooks", () => {
  it("emits instance response schemas + query hooks for an observable workflow", async () => {
    const mod = await apiModule(SAGA);
    expect(mod).toContain("export const FulfillmentInstanceResponse = z.object({");
    expect(mod).toMatch(/orderId: z\.string\(\)/);
    expect(mod).toMatch(/status: FulfillmentStatusSchema/);
    expect(mod).toContain(
      "export const FulfillmentInstanceListResponse = z.array(FulfillmentInstanceResponse);",
    );
    expect(mod).toContain("export function useAllFulfillmentInstances() {");
    expect(mod).toContain("export function useFulfillmentInstanceById(id: string | undefined) {");
    expect(mod).toContain("await api.get(`/workflows/fulfillment/instances`)");
    expect(mod).toMatch(/await api\.get\(`\/workflows\/fulfillment\/instances\/\$\{seg\(id\)\}`\)/);
    // useQuery is imported once an observable workflow exists.
    expect(mod).toContain('import { useMutation, useQuery } from "@tanstack/react-query";');
    // The enum schema the response references is BOUND — and here that means
    // declared in this module, not imported.
    //
    // This assertion used to read `import { FulfillmentStatusSchema } from
    // "./order"`, and that was pinning the #2864 T3 defect as if it were the
    // contract.  `Order` is `{ total: int }`: it does not use
    // `FulfillmentStatus`, so `api/order.ts` emits no schema for it and that
    // import resolved to nothing (`vue-tsc` TS2305, `svelte-check`).  The
    // resolver reached `./order` only through an `aggregates[0]` fallback that
    // fired precisely when no aggregate owned the type.  An enum reachable only
    // from a workflow's persisted state is owned by no aggregate module, so the
    // workflows module declares it — the same thing the Hono workflow router
    // does with its own `const <Enum>Schema`.
    expect(mod).toContain('export const FulfillmentStatusSchema = z.enum(["Pending", "Shipped"]);');
    expect(mod).not.toContain('from "./order"');
  });

  it("emits no instance hooks (and no useQuery import) for a command-only workflow", async () => {
    const mod = await apiModule(COMMAND_ONLY);
    expect(mod).not.toContain("Instances");
    expect(mod).not.toContain("InstanceResponse");
    expect(mod).toContain('import { useMutation } from "@tanstack/react-query";');
  });
});
