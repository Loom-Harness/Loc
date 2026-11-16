// Gate for D-NO-READ-BACK (docs/decisions).
//
// `loom_render_file` / `loom_hatches` — the on-demand surface: the fresh
// content of any output path, and every hatch file with its expected
// signatures, rendered from the model without writing or reading files.

import { describe, expect, it } from "vitest";
import type { HatchesReport, RenderFileReport } from "../../src/api/index.js";
import { withHatchStubs } from "../../src/system/index.js";
import { callTool } from "../../src/tools/index.js";
import { generateSystemResult } from "../_helpers/generate.js";
import { corpusSourceFor } from "../fixtures/corpus/harness.js";
import { corpusFeature } from "../fixtures/corpus/manifest.js";

/** The corpus backend keys (`vanilla` is the Elixir backend). */
const PLATFORMS = ["node", "dotnet", "java", "python", "vanilla"] as const;
/** The corpus fixtures that declare an `extern` operation or handler. */
const EXTERN_FIXTURES = ["error-codes", "extern", "extern-handlers"] as const;

describe("loom_hatches / loom_render_file", () => {
  it.each(PLATFORMS)("%s: renders exactly what generation lays out", async (platform) => {
    const source = corpusSourceFor("extern-handlers", platform);
    const emission = await generateSystemResult(source);
    const tree = withHatchStubs(emission);

    const [missing, ...existing] = [...emission.hatches.keys()].sort();
    const report = (await callTool("loom_hatches", { source, existing })) as HatchesReport;
    expect(report.ok).toBe(true);
    expect(report.hatches.map((h) => h.path)).toEqual([...emission.hatches.keys()].sort());
    const byOwner = Object.fromEntries(report.hatches.map((h) => [h.owner, h]));
    expect(byOwner["Sales.GetQuote"]!.signatures).toEqual(["GetQuote(sku: string): string"]);
    expect(byOwner["Sales.GetQuote"]!.kind).toBe("extern-query-handler");
    expect(byOwner["Sales.PlaceOrder"]!.signatures).toEqual([
      "PlaceOrder(customerId: string): Order id",
    ]);
    // `existing` decides the state; nothing on disk is consulted.
    for (const h of report.hatches) {
      expect(h.state).toBe(h.path === missing ? "pending" : "present");
      expect(h.stub).toBe(tree.get(h.path));
    }

    for (const h of report.hatches) {
      const r = (await callTool("loom_render_file", { source, path: h.path })) as RenderFileReport;
      expect(r).toMatchObject({ ok: true, role: "hatch-stub", owner: h.owner, content: h.stub });
    }
    const generatedPath = [...emission.files.keys()].find((p) => p.endsWith("docker-compose.yml"))!;
    const g = (await callTool("loom_render_file", {
      source,
      path: generatedPath,
    })) as RenderFileReport;
    expect(g).toMatchObject({
      ok: true,
      role: "generated",
      content: emission.files.get(generatedPath),
    });
    const none = (await callTool("loom_render_file", {
      source,
      path: "no/such/file",
    })) as RenderFileReport;
    expect(none).toMatchObject({ ok: true, role: "absent" });
    expect(none.content).toBeUndefined();
  });

  it("names an extern operation's hooks with their parameters", async () => {
    const report = (await callTool("loom_hatches", {
      source: corpusSourceFor("extern", "node"),
    })) as HatchesReport;
    const order = report.hatches.find((h) => h.owner === "Sales.Order");
    expect(order?.kind).toBe("extern-operations");
    expect(order?.signatures).toEqual(["confirm()", "flag(score: int)"]);
    expect(order?.state).toBeUndefined();
  });

  // Every stub carries an owner key the contract derivation must resolve; a
  // miss throws.  Swept over every corpus fixture with an extern × 5 backends.
  it.each(EXTERN_FIXTURES)("%s: every hatch on every backend has a contract", async (id) => {
    const backends = corpusFeature(id)!.backends;
    expect(backends.length).toBeGreaterThan(0);
    for (const platform of backends) {
      const report = (await callTool("loom_hatches", {
        source: corpusSourceFor(id, platform),
      })) as HatchesReport;
      expect(report.ok, JSON.stringify(report.diagnostics)).toBe(true);
      expect(report.hatches.length).toBeGreaterThan(0);
      for (const h of report.hatches) expect(h.signatures.length).toBeGreaterThan(0);
    }
  });
});
