// Read-only workflow-instance routes (workflow-instance-visibility.md): a
// correlation-bearing workflow gets `GET /<snake>/instances` +
// `GET /<snake>/instances/{id}` over its saga-state table, plus the
// `<Wf>InstanceResponse` / `<Wf>InstanceListResponse` Zod DTOs — the read-side
// analogue of an aggregate's GET list / GET-by-id.  Emitted even for an
// event-triggered-only saga (no command route), driven off `instanceWireShape`.

import { describe, expect, it } from "vitest";
import { generateBackendFromFile } from "../../_helpers/generate.js";

async function workflowsFile(file: string): Promise<string> {
  const files = await generateBackendFromFile(file, "node");
  return files.get("http/workflows.ts") ?? "";
}

describe("Hono workflow instance routes", () => {
  it("does not emit instance routes for a workflow without a correlation field", async () => {
    // examples/sales.ddd has command workflows but no correlation-bearing saga.
    const wf = await workflowsFile("examples/sales.ddd");
    expect(wf).not.toContain("/instances");
    expect(wf).not.toMatch(/InstanceListResponse/);
  });

  it("declares the byId param as a uuid (aggregate ids are always guid)", async () => {
    const wf = await workflowsFile("test/fixtures/dispatch-sample.ddd");
    expect(wf).toContain("request: { params: z.object({ id: UuidString }) },");
  });
});

// Event-sourced instance reads (workflow-and-applier.md A2-S5b): the route
// paths + operationIds + DTOs are identical to the state path (cross-backend
// OpenAPI parity by construction); only the READ BODY diverges — LIST folds via
// the `loadAll<T>` group-fold, byId single-stream load + fold + 404.
