// Auto-generated.  Do not edit by hand.
import { describe, it, expect } from "vitest";
import { WorkOrder } from "./workOrder";
import { WorkOrderStatus, Priority } from "./value-objects";
import * as Ids from "./ids";

describe("WorkOrder", () => {
  it("cannot complete with no lines", () => {
    const wo = WorkOrder.create({ customerId: Ids.CustomerId("11111111-1111-1111-1111-111111111111"), siteId: Ids.SiteId("11111111-1111-1111-1111-111111111111"), status: WorkOrderStatus.InProgress, priority: Priority.Normal, currency: "USD" });
    expect(() => { wo.complete("done"); }).toThrow();
  });

});
