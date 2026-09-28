// Three emitter defects that a value object holding a CROSS-AGGREGATE reference
// is the only shape to reach — the tail of freight audit D3 (#2881 fixed the
// import half and left these).
//
// What makes them one family: a `valueobject Berth { ship: Ship id }` forces a
// SECOND aggregate into places that had only ever seen one, and three emitters
// had each quietly assumed one.
//
//   A  a unit-test body naming a second aggregate emitted `Ship.create(...)`
//      with no import — node TS2304, python F821, dotnet CS0246, java
//      `cannot find symbol`.  Elixir is unaffected: it spells the sibling
//      fully qualified (`D.Docking.Ship.create`), so it needs no import.
//   B  python hydrated a CROSS-CONTEXT value object as an opaque column
//      (`berth=row.berth`) against flattened `berth_ship`/`berth_position`
//      columns — AttributeError on every read.  Node/dotnet/java were measured
//      correct on the same model, not assumed.
//   C  elixir emitted `create index(:docks, [:berth_ship])` on a table whose
//      value object collapses to ONE `:map` column — a migration that FAILS TO
//      APPLY.  The compile tier compiles migrations; it never applies them, so
//      this shipped green.
//
// A and C are reachable from the shipped `vo-id-reference` corpus fixture; the
// per-backend compile tiers own whether the projects BUILD, and this file owns
// the emitted SHAPE so a regression is a `npm test` failure in seconds.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";
import { generateCorpusCase } from "../fixtures/corpus/harness.js";

function fileEndingWith(files: Map<string, string>, suffix: string): string {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  expect(hit, `no emitted file ends with ${suffix} — the probe is stale`).toBeDefined();
  return hit![1];
}

/** Two contexts: the value object (and the aggregate its id points at) in one,
 *  the aggregate HOLDING it in the other.  A legal cross-context reference. */
const CROSS_CONTEXT = `system Ports {
  subdomain Harbour {
    context Alpha {
      aggregate Ship { name: string  create(name: string) { } }
      valueobject Berth { ship: Ship id  position: int }
      repository Ships for Ship { }
    }
    context Beta {
      aggregate Dock with crudish { name: string  berth: Berth }
      repository Docks for Dock { }
    }
  }
  api HarbourApi from Harbour
  storage primary { type: postgres }
  resource alphaState { for: Alpha, kind: state, use: primary }
  resource betaState { for: Beta, kind: state, use: primary }
  deployable d {
    platform: python
    contexts: [Alpha, Beta]
    dataSources: [alphaState, betaState]
    serves: HarbourApi
    port: 4000
  }
}`;

/** One context, two aggregates, and a value object holding a reference from one
 *  to the other — the smallest model whose unit test MUST name a sibling.
 *  Deliberately inline rather than the `vo-id-reference` corpus fixture: giving
 *  that fixture a `test` block needed a chain of per-backend concessions (a C#
 *  non-constant default, an elixir list literal, an elixir aggregate with no
 *  emitted factory), none of them this defect.  The import question is answered
 *  here; the fixture keeps its own subject. */
const SIBLING = (platform: string) => `system Ports {
  subdomain Harbour { context Docking {
    aggregate Ship with crudish { name: string }
    valueobject Berth { ship: Ship id  position: int }
    aggregate Dock with crudish {
      name: string
      berth: Berth
      test "an id carried by a value object survives construction" {
        let s = Ship.create({ name: "Aurora" })
        let d = Dock.create({ name: "North", berth: Berth { ship: s.id, position: 3 } })
        expect(d.berth.position).toBe(3)
      }
    }
    repository Ships for Ship { }
    repository Docks for Dock { }
  } }
  api DockingApi from Harbour
  storage primary { type: postgres }
  resource dState { for: Docking, kind: state, use: primary }
  deployable d {
    platform: ${platform}
    contexts: [Docking]
    dataSources: [dState]
    serves: DockingApi
    port: 4000
  }
}`;

describe("A — a unit-test body may name a second aggregate", () => {
  it("node imports the sibling aggregate from its own module", async () => {
    const src = fileEndingWith(await generateSystemFiles(SIBLING("node")), "domain/dock.test.ts");
    expect(src).toContain('import { Ship } from "./ship";');
    expect(src).toContain("Ship.create(");
  });

  it("python imports the sibling aggregate from its own module", async () => {
    const src = fileEndingWith(await generateSystemFiles(SIBLING("python")), "tests/test_dock.py");
    expect(src).toContain("from app.domain.ship import Ship");
    expect(src).toContain("Ship.create(");
  });

  it(".NET `using`s the sibling aggregate's own namespace", async () => {
    const src = fileEndingWith(await generateSystemFiles(SIBLING("dotnet")), "DockTests.cs");
    expect(src).toMatch(/using \w+\.Domain\.Ships;/);
    expect(src).toContain("Ship.Create(");
  });

  it("java imports the sibling aggregate's root class", async () => {
    const src = fileEndingWith(await generateSystemFiles(SIBLING("java")), "DockTests.java");
    expect(src).toMatch(/import [\w.]+\.Ship;/);
    expect(src).toContain("Ship.create(");
  });

  it("elixir needs no import — it spells the sibling fully qualified", async () => {
    // Stated as an assertion rather than left implicit: it is why this fix is
    // four backends and not five, and a future refactor that switched elixir to
    // bare module names would need its own import arm.  Probed on a LIST-FREE
    // body, because the corpus fixture's own block trips a separate, documented
    // elixir limitation — see the next test.
    const src = fileEndingWith(
      await generateSystemFiles(`system Ports {
  subdomain Harbour { context Docking {
    aggregate Ship { name: string  create(name: string) { } }
    valueobject Berth { ship: Ship id  position: int }
    aggregate Dock with crudish {
      name: string
      berth: Berth
      test "sibling reachable" {
        let s = Ship.create({ name: "Aurora" })
        let d = Dock.create({ name: "North", berth: Berth { ship: s.id, position: 3 } })
        expect(d.berth.position).toBe(3)
      }
    }
    repository Ships for Ship { }
    repository Docks for Dock { }
  } }
  api DockingApi from Harbour
  storage primary { type: postgres }
  resource dState { for: Docking, kind: state, use: primary }
  deployable d {
    platform: elixir
    contexts: [Docking]
    dataSources: [dState]
    serves: DockingApi
    port: 4000
  }
}`),
      "test/docking/dock_test.exs",
    );
    expect(src).toMatch(/[A-Z]\w*\.Docking\.Ship\.create\(/);
  });

  it("elixir needs no import — it spells the sibling fully qualified", async () => {
    // Why this fix is four backends and not five.  A refactor that switched
    // elixir to bare module names would need its own import arm, so the
    // qualified spelling is asserted rather than left implicit.
    const src = fileEndingWith(
      await generateSystemFiles(SIBLING("elixir")),
      "test/docking/dock_test.exs",
    );
    expect(src).toMatch(/[A-Z]\w*\.Docking\.Ship\.create\(/);
    expect(src).not.toContain("@tag :skip");
  });

  it("a test body that names NO sibling keeps an import-clean header", async () => {
    // The other half of a conditional import: adding every aggregate
    // unconditionally would pass the cases above and put a dead import into
    // every generated test file.
    const src = fileEndingWith(
      await generateSystemFiles(`system Solo {
  subdomain S { context C {
    aggregate Widget with crudish {
      size: int
      test "size round-trips" {
        let w = Widget.create({ size: 3 })
        expect(w.size).toBe(3)
      }
    }
    aggregate Unrelated { label: string  create(label: string) { } }
    repository Widgets for Widget { }
    repository Unrelateds for Unrelated { }
  } }
  api SoloApi from S
  storage primary { type: postgres }
  resource sState { for: C, kind: state, use: primary }
  deployable d {
    platform: node
    contexts: [C]
    dataSources: [sState]
    serves: SoloApi
    port: 4000
  }
}`),
      "domain/widget.test.ts",
    );
    expect(src).not.toContain("./unrelated");
  });
});

describe("B — a cross-context value object hydrates from its flattened columns", () => {
  it("python rebuilds the VO instead of reading a column that does not exist", async () => {
    const src = fileEndingWith(
      await generateSystemFiles(CROSS_CONTEXT),
      "repositories/dock_repository.py",
    );
    // The defect: the opaque-column arm, against columns that are flattened.
    expect(src).not.toContain("berth=row.berth,");
    expect(src).toContain("berth=Berth(ShipId(row.berth_ship), row.berth_position)");
    // …and the brand it now spells is imported (the sibling-context branch of
    // `valueObjectPool`, unobservable until this hydrate was fixed).
    expect(src).toContain("from app.domain.ids import DockId, ShipId");
  });

  it("the flattened columns it reads are the ones the schema declares", async () => {
    const schema = fileEndingWith(await generateSystemFiles(CROSS_CONTEXT), "db/schema.py");
    expect(schema).toContain("berth_ship");
    expect(schema).toContain("berth_position");
    expect(schema).not.toMatch(/^\s*berth:\s/m);
  });
});

describe("C — elixir emits no index on a column its VO collapse removed", () => {
  it("drops the leaf-column index the canonical IR mints", async () => {
    const files = await generateCorpusCase("vo-id-reference", "vanilla");
    const mig = fileEndingWith(files, "_create_docks.exs");
    // The value object is ONE `:map` column here…
    expect(mig).toContain("add :berth, :map");
    // …so an index on its flattened leaf would name a column that is never
    // created — `column "berth_ship" does not exist` when the migration runs.
    expect(mig).not.toContain("berth_ship");
  });

  it("still indexes a real column on a table with no collapsed value object", async () => {
    // The guard against over-filtering: the child table for the `Berth[]`
    // collection has an ordinary FK index, and it must survive.
    const files = await generateCorpusCase("vo-id-reference", "vanilla");
    const child = fileEndingWith(files, "_create_dock_berths.exs");
    expect(child).toMatch(/create index\(:dock_berths, \[:dock_id\]/);
  });
});
