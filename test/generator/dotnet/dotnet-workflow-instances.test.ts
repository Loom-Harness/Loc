// Read-only workflow-instance endpoints (workflow-instance-visibility.md) on
// .NET: a correlation-bearing workflow gets a <Wf>InstanceResponse DTO and a
// <Ctx>WorkflowInstancesController exposing GET workflows/<snake>/instances +
// .../instances/{id} over the EF-mapped saga-state DbSet — the read-side
// analogue of an aggregate's GET list / GET-by-id.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateBackendFiles } from "../../_helpers/generate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");

function generate(file: string): Promise<Map<string, string>> {
  return generateBackendFiles(readFileSync(path.join(root, file), "utf8"), "dotnet");
}

describe(".NET workflow instance read endpoints", () => {
  it("registers the named <Wf>InstanceListResponse wrapper pair", async () => {
    // Swashbuckle inlines `IEnumerable<T>`; the document filter promotes the
    // list response to the named carrier the other backends emit
    // (`<Wf>InstanceListResponse` — Hono z.array().openapi(), Python RootModel).
    const files = await generate("test/fixtures/dispatch-sample.ddd");
    const filter = files.get("Api/ListResponseWrapperFilter.cs") ?? "";
    expect(filter).toContain(
      '("OrderFulfillmentInstanceResponse", "OrderFulfillmentInstanceListResponse"),',
    );
  });

  it("emits no instance controller for a workflow without a correlation field", async () => {
    const files = await generate("examples/sales.ddd");
    const hasInstanceCtrl = [...files.keys()].some((k) =>
      k.endsWith("WorkflowInstancesController.cs"),
    );
    expect(hasInstanceCtrl).toBe(false);
  });
});
