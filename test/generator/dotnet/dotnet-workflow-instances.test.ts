// Read-only workflow-instance endpoints (workflow-instance-visibility.md) on
// .NET: a correlation-bearing workflow gets a <Wf>InstanceResponse DTO and a
// <Ctx>WorkflowInstancesController exposing GET workflows/<snake>/instances +
// .../instances/{id} over the EF-mapped saga-state DbSet — the read-side
// analogue of an aggregate's GET list / GET-by-id.

import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { URI } from "langium";
import { NodeFileSystem } from "langium/node";
import { describe, expect, it } from "vitest";
import { createDddServices } from "../../../src/language/ddd-module.js";
import type { Model } from "../../../src/language/generated/ast.js";
import { generateDotnet } from "../../_helpers/generate.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");

async function generate(file: string): Promise<Map<string, string>> {
  const services = createDddServices(NodeFileSystem);
  const doc = await services.shared.workspace.LangiumDocuments.getOrCreateDocument(
    URI.file(path.join(root, file)),
  );
  await services.shared.workspace.DocumentBuilder.build([doc], { validation: true });
  const errors = (doc.diagnostics ?? []).filter((d) => d.severity === 1);
  expect(
    errors.map((d) => d.message),
    "fixture validation errors",
  ).toEqual([]);
  return generateDotnet(doc.parseResult.value as Model);
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
