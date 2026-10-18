// M-T1.36 F3 — Angular typed a value-object workflow STATE field `unknown` on
// the `<Wf>InstanceRow` interface (`src/api/workflows.ts`), so a page reading
// `row.address.city` off an instance was TS2571.  The row now names the VO's
// `<Vo>Response` interface: imported from the aggregate module that already
// exports it, declared locally when only the workflow reaches it (transitively,
// with any enum the VO carries) — the same resolution #2864 T3 gave enums.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

function source(claimFields: string): string {
  return `
    system S {
      subdomain Claims { context Review {
        enum Region { North, South }
        valueobject Address { city: string, region: Region }
        valueobject Note { text: string }
        aggregate Claim with crudish { reference: string ${claimFields} }
        repository Claims for Claim { }
        event ClaimFiled { claim: Claim id, at: datetime }
        channel ClaimLifecycle { carries: ClaimFiled delivery: broadcast retention: ephemeral }
        workflow Review {
          claim: Claim id
          address: Address?
          notes: Note[]
          create(e: ClaimFiled) by e.claim { }
        }
      } }
      api ReviewApi from Claims
      storage pg { type: postgres }
      resource st { for: Review, kind: state, use: pg }
      deployable api { platform: node, contexts: [Review], dataSources: [st], serves: ReviewApi, port: 4000 }
      ui Web { framework: angular api Claims: ReviewApi page P { route: "/" body: Text { "x" } } }
      deployable web { platform: angular, targets: api, ui: Web { Claims: api }, port: 3001 }
    }`;
}

async function workflowsModule(claimFields: string): Promise<string> {
  const files = await generateSystemFiles(source(claimFields));
  const mod = files.get("web/src/api/workflows.ts");
  if (!mod)
    throw new Error(
      `no workflows.ts; files: ${[...files.keys()].filter((k) => k.startsWith("web/src/api")).join(", ")}`,
    );
  return mod;
}

describe("Angular workflow instance row: value-object state fields (F3)", () => {
  it("declares a workflow-only VO (and the enum it carries) locally and types the row by it", async () => {
    const mod = await workflowsModule("");
    expect(mod).toContain("export interface AddressResponse {");
    expect(mod).toContain("  region: Region;");
    expect(mod).toContain('export type Region = "North" | "South";');
    expect(mod).toContain("export interface NoteResponse {");
    expect(mod).toMatch(
      /export interface ReviewInstanceRow \{[^}]*address: AddressResponse \| null;/,
    );
    expect(mod).toMatch(/export interface ReviewInstanceRow \{[^}]*notes: NoteResponse\[\];/);
    expect(mod).not.toMatch(/address: unknown/);
  });

  it("imports the VO interface from the aggregate module that already exports it", async () => {
    const mod = await workflowsModule("home: Address");
    expect(mod).toContain('import type { AddressResponse } from "./claim";');
    expect(mod).toContain('import type { Region } from "./claim";');
    expect(mod).not.toContain("export interface AddressResponse {");
    // Note is still workflow-only.
    expect(mod).toContain("export interface NoteResponse {");
  });
});
