// A param or `let` named like a `resource` SHADOWS the resource handle —
// ruling D7, eval-closure-review item 17.
//
// `resolveNameRef` used to resolve ambient resource handles BEFORE locals
// ("not shadowable, mirroring currentUser"), so next to `resource st { … }`
// the RHS of `create(name, st) { st := st }` lowered to the resource handle
// instead of the param.  The lifecycle gate — which exempts a create body that
// only copies its own params — then reported a spurious
// `loom.lifecycle-body-dropped`.  Lexical binders now win; an unshadowed name
// still resolves to the resource.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { ExprIR, WorkflowStmtIR } from "../../src/ir/types/loom-ir.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

const CRUDISH = `
system Cargo {
  subdomain Core {
    context Ships {
      aggregate Ship with crudish {
        name: string
        st: string
      }
      repository Ships for Ship { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Ships, kind: state, use: primary }
  deployable api { platform: node, contexts: [Ships], dataSources: [st], port: 8000 }
}
`;

const WORKFLOW = `
system Sys {
  subdomain Sales { context Sales {
    aggregate Order { name: string }
    workflow Archive { create(salesFiles: string) {
      let blob = salesFiles.size
      let out = salesFiles
    } }
    workflow Keep { create(name: string) { salesFiles.put("k/" + name, name) } }
  } }
  storage pg { type: postgres }
  storage files { type: s3, config: { bucket: "b" } }
  resource salesState { for: Sales, kind: state, use: pg }
  resource salesFiles { for: Sales, kind: objectStore, use: files }
  deployable api { platform: node, contexts: [Sales], dataSources: [salesState, salesFiles], port: 3000 }
}
`;

async function enriched(src: string) {
  const { model, errors } = await parseString(src);
  expect(errors).toEqual([]);
  return enrichLoomModel(lowerModel(model));
}

describe("params and lets shadow resource handles (D7)", () => {
  it("a crudish create copying a param named like a resource is not a dropped body", async () => {
    const m = await enriched(CRUDISH);
    const diags = validateLoomModel(m);
    expect(diags.map((d) => d.code)).not.toContain("loom.lifecycle-body-dropped");
    const ship = m.systems[0]!.subdomains[0]!.contexts[0]!.aggregates.find(
      (a) => a.name === "Ship",
    )!;
    const stAssign = (ship.canonicalCreate?.statements ?? []).find(
      (s) => s.kind === "assign" && s.target.segments.join(".") === "st",
    );
    expect(stAssign).toBeDefined();
    const value = (stAssign as { value: ExprIR }).value;
    expect(value).toMatchObject({ kind: "ref", name: "st", refKind: "param" });
  });

  it("a workflow param named like a resource shadows it; elsewhere the resource still resolves", async () => {
    const m = await enriched(WORKFLOW);
    const ctx = m.systems[0]!.subdomains[0]!.contexts[0]!;
    const archive = ctx.workflows.find((w) => w.name === "Archive")!.statements;
    const out = archive.find(
      (s): s is Extract<WorkflowStmtIR, { kind: "expr-let" }> =>
        s.kind === "expr-let" && s.name === "out",
    )!;
    expect(out.expr).toMatchObject({ kind: "ref", name: "salesFiles", refKind: "param" });

    const keep = ctx.workflows.find((w) => w.name === "Keep")!.statements;
    expect(keep.some((s) => s.kind === "resource-call")).toBe(true);
  });
});
