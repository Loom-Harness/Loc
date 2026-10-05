// ---------------------------------------------------------------------------
// A CONTAINMENT row is an entity PART, and the walker's row-record resolution
// only knew aggregates.
//
// `IdLink`'s null guard (M-T1.33, `id-link-optional-cross-target.test.ts`) asks
// `apiReadMemberType` whether the reference it links from is declared optional,
// and that resolution indexed `ctx.aggregatesByName`.  A scaffolded detail
// page's CHILD table binds a part — `Table(rows: wo.lines)` over
// `contains lines: WorkOrderLine[]` — and a part is in no aggregate map, so
// every cell of every containment table resolved to "unknown", which reads as
// REQUIRED.
//
// So `part: Part id?` inside the contained entity reached the packs unguarded:
// Feliz emitted `("/parts/" + row.part)` over a `string option` — FS0001,
// `dotnet build` fails outright — and the JS frontends linked to
// `/parts/undefined`.  All from a `.ddd` that validated `0 error(s),
// 0 warning(s)`.
//
// The contained entity carries BOTH an optional and a required reference, so a
// fix that guarded every containment link indiscriminately fails here too.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const containmentSystem = (platform: string): string => `
  system Field {
    subdomain Ops {
      context Work {
        aggregate Part with crudish {
          code: string
          derived display: string = code
        }
        repository Parts for Part { }
        aggregate WorkOrder with crudish {
          title: string
          contains lines: WorkOrderLine[]
          derived display: string = title
          entity WorkOrderLine {
            description: string
            part:    Part id?
            catalog: Part id
            quantity: int
          }
        }
        repository WorkOrders for WorkOrder { }
      }
    }
    ui Web with scaffold(subdomains: [Ops]) { }
    api OpsApi from Ops
    storage primary { type: postgres }
    resource workState { for: Work, kind: state, use: primary }
    deployable api {
      platform: node, contexts: [Work], dataSources: [workState],
      serves: OpsApi, port: 4300
    }
    deployable web { platform: ${platform}, targets: api, hosts: Web }
  }
`;

async function generate(platform: string): Promise<string> {
  const files = await generateSystemFiles(containmentSystem(platform));
  let all = "";
  for (const content of files.values()) all += `\n${content}`;
  return all;
}

describe("a containment row's optional reference is null-guarded", () => {
  it("feliz unwraps the option rather than concatenating it", async () => {
    const out = await generate("feliz");
    // The guard's BINDING form: the option is split and the link is built over
    // the unwrapped local, never over the `string option` itself.
    expect(out).toMatch(/match row\.part with \| Some __id ->/);
    expect(out).toContain('("/parts/" + __id)');
    expect(out).not.toContain('("/parts/" + row.part)');
  });

  it("feliz leaves a REQUIRED containment reference unguarded", async () => {
    const out = await generate("feliz");
    expect(out).toContain('("/parts/" + row.catalog)');
    expect(out).not.toContain("match row.catalog with");
  });

  it("react renders the em dash rather than linking to /parts/undefined", async () => {
    const out = await generate("react");
    expect(out).toMatch(/\{row\.part \? \(/);
    expect(out).toContain("<span>—</span>");
    // …and the required one still links unconditionally.
    expect(out).not.toMatch(/\{row\.catalog \? \(/);
  });
});
