// Where a ui renders `Apps {}`, the gateway's apps.  Read by the capability
// check (`loom.target-unsupported#apps`, LiveView).

import type { ExprIR } from "../types/loom-ir.js";
import { walkExprDeep } from "./walk.js";

/** True when a page/component body contains an `Apps {}` call anywhere. */
export function bodyUsesApps(body: ExprIR | undefined): boolean {
  let found = false;
  walkExprDeep(body, (e) => {
    if (e.kind === "call" && e.name === "Apps") found = true;
  });
  return found;
}
