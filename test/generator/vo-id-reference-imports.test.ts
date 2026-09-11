// A VALUE OBJECT that names a type from ANOTHER emitted file.
//
// `renderTsType` maps an `id` type to `Ids.<Agg>Id`, a namespace that lives in
// `domain/ids.ts`.  The value-object emitter derived its import header from the
// VO's FIELDS and nothing else, and had no `Ids` arm at all — so
// `valueobject Berth { ship: Ship id }` emitted `domain/value-objects.ts` with
// ZERO import statements and `readonly ship: Ids.ShipId` inside it:
// `TS2503: Cannot find namespace 'Ids'`, twice (freight audit D3 / M-T6.64).
//
// This is the FAST half of the proof.  `corpus:vo-id-reference` owns whether
// the emitted projects actually BUILD on all five backends; this file owns the
// import HEADER, so a regression is a `npm test` failure in seconds rather than
// a compile-tier failure minutes later — and so the three type POSITIONS that
// can each name an id independently (a field, a `derived` type, a `function`
// parameter) are each pinned on their own, which no corpus fixture can do
// without three near-identical fixtures.
//
// The other four backends were already correct — python imports the id NewType,
// .NET collects `using`s over the same four positions, java wildcard-imports
// the ids package, elixir is untyped — so their assertions here are a
// REGRESSION guard on behaviour that already shipped, not a new claim.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";
import { generateCorpusCase } from "../fixtures/corpus/harness.js";

const FEATURE = "vo-id-reference";

function fileEndingWith(files: Map<string, string>, suffix: string): string {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  expect(hit, `no emitted file ends with ${suffix} — the probe is stale`).toBeDefined();
  return hit![1];
}

/** A one-context system whose sole value object names an id in exactly ONE
 *  rendered type position, so each position is proven to drive the import on
 *  its own.  `body` is spliced into `valueobject Berth { … }`. */
function systemWith(body: string): string {
  return `system Ports {
  subdomain Harbour {
    context Docking {
      aggregate Ship { name: string }
      valueobject Berth {
        ${body}
      }
      aggregate Dock with crudish { name: string  berth: Berth }
      repository Ships for Ship { }
      repository Docks for Dock { }
    }
  }
  api DockingApi from Harbour
  storage primary { type: postgres }
  resource dockingState { for: Docking, kind: state, use: primary }
  deployable d {
    platform: node
    contexts: [Docking]
    dataSources: [dockingState]
    serves: DockingApi
    port: 4000
  }
}`;
}

describe("a value object holding a cross-aggregate reference imports its id type", () => {
  it("node: `domain/value-objects.ts` imports the Ids namespace it references", async () => {
    const src = fileEndingWith(
      await generateCorpusCase(FEATURE, "node"),
      "domain/value-objects.ts",
    );
    // The defect, stated as the thing that was missing.
    expect(src).toContain('import * as Ids from "./ids";');
    // …and the reference that made it necessary, in all three type positions.
    expect(src).toContain("readonly ship: Ids.ShipId;");
    expect(src).toContain("get assignedShip(): Ids.ShipId");
    expect(src).toContain("servesShip(other: Ids.ShipId)");
  });

  it("node: a scalar-only value object keeps an Ids-free header", async () => {
    // The other half of a CONDITIONAL import: adding it unconditionally would
    // be an equally valid way to make the case above pass, and would put a
    // dead import into nearly every generated project (the corpus is almost
    // entirely scalar-only VOs).
    const files = await generateSystemFiles(systemWith("position: int\n        label: string"));
    const src = fileEndingWith(files, "domain/value-objects.ts");
    expect(src).not.toContain("./ids");
  });

  it.each([
    ["a field", "ship: Ship id"],
    ["a `derived` type", "position: int\n        derived assignedShip: Ship id? = null"],
    [
      "a `function` parameter",
      "position: int\n        function servesShip(s: Ship id): bool = position > 0",
    ],
  ])("node: an id in %s alone drives the import", async (_label, body) => {
    const src = fileEndingWith(
      await generateSystemFiles(systemWith(body)),
      "domain/value-objects.ts",
    );
    expect(src).toContain('import * as Ids from "./ids";');
    expect(src).toContain("Ids.ShipId");
  });

  it("python: the value-objects module imports the id NewType", async () => {
    const src = fileEndingWith(
      await generateCorpusCase(FEATURE, "python"),
      "domain/value_objects.py",
    );
    expect(src).toContain("from app.domain.ids import ShipId");
    expect(src).toContain("ship: ShipId");
  });

  it("python: the REPOSITORY imports the id it brands through the VO constructor", async () => {
    // The python face of the same root cause, which this fixture is what
    // surfaced: the repository's id-import scan walked the aggregate's own (and
    // its parts') id-typed fields, and a VO's id is reachable through neither.
    // `Dock.berth` is typed `Berth`, so nothing proposed `ShipId` as a
    // candidate — while `_hydrate` renders
    // `Berth(ShipId(row.berth_ship), row.berth_position)`.  ruff `F821
    // Undefined name`, four times, and the module raises `NameError` on the
    // first read.
    const src = fileEndingWith(
      await generateCorpusCase(FEATURE, "python"),
      "repositories/dock_repository.py",
    );
    expect(src).toContain("from app.domain.ids import DockId, ShipId");
    expect(src).toContain("Berth(ShipId(row.berth_ship), row.berth_position)");
  });

  it(".NET: the value-object record `using`s the Ids namespace", async () => {
    const src = fileEndingWith(await generateCorpusCase(FEATURE, "dotnet"), "Berth.cs");
    expect(src).toMatch(/using \w+\.Domain\.Ids;/);
    expect(src).toContain("public ShipId Ship { get; init; }");
  });

  it("java: the value-object record imports the ids package", async () => {
    const src = fileEndingWith(await generateCorpusCase(FEATURE, "java"), "Berth.java");
    expect(src).toMatch(/import [\w.]+\.domain\.ids\.\*;/);
    expect(src).toContain("ShipId ship");
  });
});
