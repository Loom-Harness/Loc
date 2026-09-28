// `organizationContext` — the OPERATING-scope accessor (organization-context.md;
// M-T3.6 items 3+5).  The accessor lands ONLY with its fail-closed switch gate,
// so this file pins both halves of the compile-time contract:
//
//   - the SURFACE (`loom.org-context-surface`, AST): `.orgPath` is the one
//     member, and never inside a `ui` — a frontend has no switch gate;
//   - the GATE's preconditions (`loom.org-context-gate-unmet`, phase ⑦): a
//     tenant hierarchy to switch within, and `auth: required` on every backend
//     deployable that hosts a read — the gate lives in the auth middleware;
//   - LOWERING: `organizationContext.orgPath` is the derived principal member
//     `currentUser.orgContextPath`, so it rides every backend's principal
//     threading instead of growing a second one.
//
// The per-backend emitted gate is pinned by
// `test/generator/org-context-gate.test.ts`; the runtime proof on a booted app
// per backend is `test/e2e/tenancy-org-context*.test.ts`.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validate } from "../../../src/api/index.js";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel, mergeLoomModels } from "../../../src/ir/lower/lower.js";
import { forEachModelExpr } from "../../../src/ir/util/model-exprs.js";
import {
  contextReadsOrgContext,
  isOrgContextRead,
  systemReadsOrgContext,
} from "../../../src/ir/util/org-context.js";
import { parseValid } from "../../_helpers/parse.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = fs.readFileSync(
  path.resolve(here, "../../fixtures/corpus/org-context.ddd"),
  "utf8",
);
const on = (platform: string, src = FIXTURE): string => src.replace("__PLATFORM__", platform);

async function codes(src: string): Promise<string[]> {
  return (await validate(src)).diagnostics.map((d) => d.code ?? "?");
}

describe("organizationContext — the accepted model", () => {
  for (const platform of ["node", "dotnet", "java", "python", "elixir"]) {
    it(`the corpus fixture validates clean on ${platform}`, async () => {
      const diags = (await validate(on(platform))).diagnostics.filter(
        (d) => d.severity === "error",
      );
      expect(diags.map((d) => `${d.code}: ${d.message}`)).toEqual([]);
    });
  }
});

describe("organizationContext — surface (loom.org-context-surface)", () => {
  it("refuses a member other than orgPath", async () => {
    const src = on("node").replace(
      "scope := organizationContext.orgPath",
      "scope := organizationContext.tenantId",
    );
    const raised = await codes(src);
    expect(raised).toContain("loom.org-context-surface");
    // Owned by the surface check alone — not ALSO an undeclared-claim report.
    expect(raised).not.toContain("loom.unknown-user-claim");
  });

  it("refuses an unknown member without double-reporting it as a claim", async () => {
    const src = on("node").replace(
      "scope := organizationContext.orgPath",
      "scope := organizationContext.orgId",
    );
    const raised = await codes(src);
    expect(raised).toContain("loom.org-context-surface");
    expect(raised).not.toContain("loom.unknown-user-claim");
  });

  it("refuses a bare organizationContext (the frame is not a value)", async () => {
    const src = on("node").replace(
      "scope := organizationContext.orgPath",
      "scope := organizationContext",
    );
    expect(await codes(src)).toContain("loom.org-context-surface");
  });

  it("refuses a read inside a ui (no switch gate on a frontend)", async () => {
    const src = on("node").replace(
      "  api BooksApi from Core",
      `  ui Web {
    page Home {
      body: Text(organizationContext.orgPath)
    }
  }
  api BooksApi from Core`,
    );
    const { diagnostics } = await validate(src);
    const surface = diagnostics.filter((d) => d.code === "loom.org-context-surface");
    expect(surface.length).toBeGreaterThan(0);
    expect(surface.some((d) => /inside a 'ui'/.test(d.message))).toBe(true);
  });
});

describe("organizationContext — gate preconditions (loom.org-context-gate-unmet)", () => {
  it("refuses a read on a deployable without auth", async () => {
    const { diagnostics } = await validate(on("node").replace("    auth: required\n", ""));
    const gate = diagnostics.filter((d) => d.code === "loom.org-context-gate-unmet");
    expect(gate.map((d) => d.message).join("\n")).toMatch(/deployable 'd' hosts it without/);
  });

  it("refuses a read with no tenant hierarchy to switch within", async () => {
    const flat = on("node")
      .replace("        implements tenantRegistry\n", "")
      .replace("        operation setPath(p: string) { dataKey := p }\n", "")
      .replace("allow deep on Account", "allow local on Account");
    const { diagnostics } = await validate(flat);
    const gate = diagnostics.filter((d) => d.code === "loom.org-context-gate-unmet");
    expect(gate.map((d) => d.message).join("\n")).toMatch(/no tenant hierarchy/);
  });

  for (const platform of ["dotnet", "java", "python", "elixir"]) {
    it(`fires on ${platform} too — every backend hosts the gate or refuses the read`, async () => {
      const raised = await codes(on(platform).replace("    auth: required\n", ""));
      expect(raised).toContain("loom.org-context-gate-unmet");
    });
  }
});

describe("organizationContext — lowering (one frame underneath)", () => {
  it("lowers organizationContext.orgPath to the derived principal member", async () => {
    const model = await parseValid(on("node"));
    const loom = enrichLoomModel(mergeLoomModels([lowerModel(model)]));
    const reads: string[] = [];
    forEachModelExpr(loom, (v) => {
      if (isOrgContextRead(v.expr)) reads.push(v.site);
    });
    // The stamp AND the operation body — both through the principal ref.
    expect(reads).toContain("ContextStampAssignmentIR.value");
    expect(reads).toContain("OperationIR.statements");
    const sys = loom.systems[0]!;
    expect(systemReadsOrgContext(sys)).toBe(true);
    const books = sys.subdomains.flatMap((s) => s.contexts).find((c) => c.name === "Books")!;
    expect(contextReadsOrgContext(books)).toBe(true);
  });

  it("a system that never reads it derives false (the gate is not emitted)", async () => {
    const plain = fs.readFileSync(
      path.resolve(here, "../../fixtures/corpus/tenancy-hierarchy.ddd"),
      "utf8",
    );
    const model = await parseValid(plain.replace("__PLATFORM__", "node"));
    const loom = enrichLoomModel(mergeLoomModels([lowerModel(model)]));
    expect(systemReadsOrgContext(loom.systems[0]!)).toBe(false);
  });
});
