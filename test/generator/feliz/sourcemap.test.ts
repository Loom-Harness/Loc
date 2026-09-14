import { describe, expect, it } from "vitest";
import type { OriginRef } from "../../../src/ir/types/origin.js";
import { generateSystems } from "../../../src/system/index.js";
import { parseValid } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// Feliz frontend recording bracket — the feliz half of the ledger row
// `sourcemap-feliz-flutter-not-emitted`.  `--sourcemap` used to record NOTHING
// for a feliz ui: `src/platform/feliz.ts`'s `emitProject` did not even
// destructure `sourcemap`, and no call site in `src/generator/feliz/` touched a
// `SourceMapRecorder` — so `.loom/sourcemap.json` carried backend files only
// and `ddd breakpoints` / `ddd trace` could not reach the frontend at all.
//
// Feliz is NOT file-per-page: one `src/App.fs` holds every page's view
// function, so the recording rides `fragment()` (anchored by each view's own
// text, which records nothing rather than guessing when the anchor is absent or
// ambiguous) instead of the `file()` call the four JS frontends use.  That is
// why the regions below are LINE RANGES inside one file and why the assertions
// check each range against the real content.
// ---------------------------------------------------------------------------

const SOURCE = `
  system Shop {
    subdomain Sales {
      context Orders {
        aggregate Widget {
          name: string
        }
        repository Widgets for Widget { }
      }
    }
    storage primary { type: postgres }
    resource ordersState { for: Orders, kind: state, use: primary }
    api SalesApi from Sales
    ui WebApp with scaffold(subdomains: [Sales]) { }
    deployable api { platform: node, contexts: [Orders], dataSources: [ordersState], serves: SalesApi, port: 3000 }
    deployable web { platform: feliz, targets: api, ui: WebApp, port: 3005 }
  }
`;

type Region = { target: [number, number]; construct?: string; origin: OriginRef };

async function felizRegions(): Promise<{ app: string; regions: Region[] }> {
  const model = await parseValid(SOURCE);
  const files = generateSystems(model, { sourcemap: true }).files;
  const map = JSON.parse(files.get(".loom/sourcemap.json")!) as {
    files: Record<string, Region[]>;
  };
  return { app: files.get("web/src/App.fs")!, regions: map.files["web/src/App.fs"] ?? [] };
}

describe("feliz generator — sourcemap recording", () => {
  it("records every scaffolded page as a region of the single `src/App.fs`", async () => {
    const { regions } = await felizRegions();
    expect(regions.length, "no region recorded for web/src/App.fs").toBeGreaterThan(0);
    const constructs = regions.map((r) => r.construct);
    // The scaffold's own role-scoped ids, disambiguated by area — the SAME
    // `pageConstructId` spelling react / vue / svelte / angular record.
    expect(constructs).toContain("WebApp.widgets.List");
    expect(constructs).toContain("WebApp.widgets.Detail");
    expect(constructs).toContain("WebApp.Home");
    for (const r of regions) expect(r.origin.kind).toBe("macro");
  });

  it("each region's line range is the page's own view function, not the whole file", async () => {
    const { app, regions } = await felizRegions();
    const appLines = app.split("\n");
    const list = regions.find((r) => r.construct === "WebApp.widgets.List")!;
    const [start, end] = list.target;
    // A region that covered the whole file would still "resolve" and would
    // still look green to a `toBeDefined()` check — so assert the BOUNDARY: the
    // first line is this page's view binding, and the line after the region is
    // no longer inside it.
    expect(appLines[start - 1]).toMatch(/^let widgetListView \(model: Model\)/);
    expect(end).toBeGreaterThan(start);
    expect(end).toBeLessThan(appLines.length);
    expect(appLines[end]).not.toMatch(/^\s/);
    // Regions do not overlap — each page owns a disjoint slice.
    const sorted = [...regions].sort((a, b) => a.target[0] - b.target[0]);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i]!.target[0]).toBeGreaterThan(sorted[i - 1]!.target[1]);
    }
  });

  it("off by default — no sourcemap artifact, App.fs unaffected", async () => {
    const model = await parseValid(SOURCE);
    const withMap = generateSystems(model, { sourcemap: true }).files;
    const without = generateSystems(model).files;
    expect(without.has(".loom/sourcemap.json")).toBe(false);
    // The recorder must not perturb emission — byte-identical either way.
    expect(without.get("web/src/App.fs")).toBe(withMap.get("web/src/App.fs"));
  });
});
