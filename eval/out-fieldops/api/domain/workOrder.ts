// loom:scaffold-once — this file is yours.  Loom scaffolds it on the first
// `generate` and NEVER overwrites it again, so your implementation survives
// every regenerate.  Replace each `throw` with the operation's real domain logic.
import { NotImplementedError } from "./errors";
import { WorkOrderBase } from "./workOrder.base";
export { Photo, WorkOrderLine } from "./workOrder.base";

/**
 * WorkOrder — the concrete aggregate.  Loom generates the machinery in
 * `workOrder.base.ts` (regenerated each run) and leaves each `extern` operation's
 * hand-written body to you here.  Every `*Extern` method is the body of an
 * `operation … extern`: mutate `this._<field>` directly and call
 * `this._raiseEvent(...)` to emit; the framework runs the operation's
 * preconditions before and re-asserts invariants after.
 */
export class WorkOrder extends WorkOrderBase {
  protected override notifyCustomerExtern(): void {
    throw new NotImplementedError("extern operation 'notifyCustomer' on WorkOrder is not implemented — write its body in src/domain/workOrder.ts");
  }
}
