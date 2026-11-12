// `workflowIsGuarded` decides whether every backend's workflow route declares
// the 403 response.  A `requires` nested in an `if let` branch still denies at
// runtime, so the declaration has to find it at any depth.  The emitted
// response list is OpenAPI wiring no booted leg diffs, so the claim is checked
// on the predicate itself.

import { describe, expect, it } from "vitest";
import { workflowIsGuarded } from "../../src/ir/types/loom-ir.js";
import { buildLoomModel, enrichedContexts } from "../_helpers/ir.js";

const model = (body: string) => `
  system S {
    user { id: string  role: string }
    subdomain D {
      context C {
        aggregate Job with crudish { title: string  operation touch() { title := title } }
        repository Jobs for Job { }
        workflow W {
          create(job: Job id) {
            ${body}
          }
        }
      }
    }
    storage pg { type: postgres }
    resource st { for: C, kind: state, use: pg }
    deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000, auth: required }
  }
`;

async function guarded(body: string): Promise<boolean> {
  const loom = await buildLoomModel(model(body));
  const wf = enrichedContexts(loom)
    .flatMap((c) => c.workflows)
    .find((w) => w.name === "W");
  expect(wf, "workflow W lowered").toBeDefined();
  return workflowIsGuarded(wf!);
}

describe("workflowIsGuarded", () => {
  it("sees a top-level requires", async () => {
    expect(
      await guarded(`requires currentUser.role == "admin"\n let j = Jobs.get(job)\n j.touch()`),
    ).toBe(true);
  });

  it("sees a requires inside an `if let` branch", async () => {
    expect(
      await guarded(
        `if let j = Jobs.find(job) {\n requires currentUser.role == "admin"\n j.touch()\n }`,
      ),
    ).toBe(true);
  });

  it("is false for a body with no requires", async () => {
    expect(await guarded(`let j = Jobs.get(job)\n j.touch()`)).toBe(false);
  });
});
