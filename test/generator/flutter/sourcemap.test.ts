import { describe, expect, it } from "vitest";
import type { OriginRef } from "../../../src/ir/types/origin.js";
import { generateSystems } from "../../../src/system/index.js";
import { parseValid } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// Flutter frontend recording bracket — the sibling of
// `test/generator/{react,vue,svelte,angular}/sourcemap.test.ts`.
//
// Ledger row `sourcemap-feliz-flutter-not-emitted` (P2, silent): `--sourcemap`
// recorded NOTHING for a `platform: flutter` deployable.  `src/platform/
// flutter.ts` did not even destructure `sourcemap` off its `emitProject`
// argument, so `ddd generate system --sourcemap` produced a map whose only
// entries were the backend's, and `ddd breakpoints <f.ddd> --line <page line>`
// answered "No generated location maps to …" for every Flutter page.
//
// TWO record families, and the second is why this file exists rather than a
// copy of the svelte one:
//   • PAGES — one file per page, so a whole-file `file()` region is honest.
//   • COMPONENTS — Flutter POOLS every user component into one
//     `lib/components.dart`.  A whole-file region there would map the entire
//     file to whichever component happened to be first, which is precisely the
//     misleading mapping `SourceMapRecorder`'s own header tells callers not to
//     emit.  So the component half rides `fragment()`, anchoring each block's
//     text, and the assertions below pin that the two components land on
//     DIFFERENT, non-overlapping line ranges — the property a `file()` call
//     could not have.
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
    ui WebApp with scaffold(subdomains: [Sales]) {
      component StatusPill(label: string) {
        body: Stack { Text { label } }
      }
      component Tagline(text: string) {
        body: Card { Text { text } }
      }
      page Board {
        route: "/board"
        body: Stack { StatusPill(label: "ok"), Tagline(text: "hi") }
      }
    }
    deployable api { platform: node, contexts: [Orders], dataSources: [ordersState], serves: SalesApi, port: 3000 }
    deployable app { platform: flutter, targets: api, ui: WebApp, port: 3006 }
  }
`;

interface Region {
  target: [number, number];
  construct?: string;
  origin: OriginRef;
}

async function mapOf(): Promise<Record<string, Region[]>> {
  const model = await parseValid(SOURCE);
  const files = generateSystems(model, { sourcemap: true }).files;
  const raw = files.get(".loom/sourcemap.json");
  expect(raw, "no .loom/sourcemap.json emitted").toBeDefined();
  return (JSON.parse(raw!) as { files: Record<string, Region[]> }).files;
}

describe("flutter generator — sourcemap recording", () => {
  it("records a hand-written page file with a source origin and the ui-scoped construct", async () => {
    const files = await mapOf();
    const path = "app/lib/pages/board_page.dart";
    const regions = files[path];
    expect(regions, `no region recorded for ${path}`).toBeDefined();
    expect(regions!.length).toBeGreaterThan(0);
    const region = regions![0]!;
    expect(region.construct).toBe("WebApp.Board");
    expect(region.origin.kind).toBe("source");
    // Whole-file: a page is its own file, so `[1, eof]` is the true region.
    expect(region.target[0]).toBe(1);
  });

  it("records each SCAFFOLDED page with a macro origin and its role-scoped construct", async () => {
    const files = await mapOf();
    const path = "app/lib/pages/widget_list_page.dart";
    const regions = files[path];
    expect(regions, `no region recorded for ${path}`).toBeDefined();
    expect(regions![0]!.construct).toBe("WebApp.widgets.List");
    expect(regions![0]!.origin.kind).toBe("macro");
  });

  it("records EACH user component separately inside the pooled components file", async () => {
    const files = await mapOf();
    const regions = files["app/lib/components.dart"];
    expect(regions, "no region recorded for app/lib/components.dart").toBeDefined();
    const byConstruct = new Map(regions!.map((r) => [r.construct, r]));
    expect([...byConstruct.keys()].sort()).toEqual(["WebApp.StatusPill", "WebApp.Tagline"]);

    // The load-bearing assertion: the two components map to DIFFERENT line
    // ranges that do not overlap.  A `file()`-style whole-file record would
    // give both `[1, eof]` — indistinguishable, and wrong for at least one of
    // them.  This is what `fragment()` anchoring buys.
    const pill = byConstruct.get("WebApp.StatusPill")!;
    const tagline = byConstruct.get("WebApp.Tagline")!;
    expect(pill.target).not.toEqual(tagline.target);
    const [lo, hi] = pill.target[0] < tagline.target[0] ? [pill, tagline] : [tagline, pill];
    expect(lo.target[1]).toBeLessThan(hi.target[0]);
    // Neither starts at line 1 — the file opens with its header comment and
    // imports, which belong to no component.
    expect(lo.target[0]).toBeGreaterThan(1);
    for (const r of [pill, tagline]) expect(r.origin.kind).toBe("source");
  });

  it("the recorded page region really spans the emitted file", async () => {
    const model = await parseValid(SOURCE);
    const files = generateSystems(model, { sourcemap: true }).files;
    const map = (
      JSON.parse(files.get(".loom/sourcemap.json")!) as { files: Record<string, Region[]> }
    ).files;
    const src = files.get("app/lib/pages/board_page.dart");
    expect(src, "board_page.dart not emitted").toBeDefined();
    const nl = src!.endsWith("\n") ? src!.split("\n").length - 1 : src!.split("\n").length;
    expect(map["app/lib/pages/board_page.dart"]![0]!.target).toEqual([1, nl]);
  });

  it("off by default — no sourcemap artifact, Dart unaffected", async () => {
    const model = await parseValid(SOURCE);
    const files = generateSystems(model).files;
    expect(files.has(".loom/sourcemap.json")).toBe(false);
    expect(files.has("app/lib/pages/board_page.dart")).toBe(true);
  });
});
