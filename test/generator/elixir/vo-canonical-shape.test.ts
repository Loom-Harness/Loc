// A value object on the vanilla Phoenix backend has ONE runtime shape at the
// column, and value-object `==` is value equality across the shapes it still
// takes elsewhere.
//
// A single value object is a jsonb column.  Typed as a bare `:map`, a value
// loaded from the row was STRING-keyed (`%{"pier" => "A", "fee" => "12.50"}`),
// one cast from a request body kept the wire's keys and numbers, and one built
// in domain code was ATOM-keyed with `%Decimal{}`s and enum atoms — so
// `record.berth == Berth { … }` was false for every persisted aggregate, and
// `record.berth.side == Port` compared `"Port"` to `:Port`.  The column is now
// a `Loom.ValueObject` parameterized type whose `cast`/`load` produce the
// constructor shape; VO `==`/`!=` render through `Loom.ValueObject.equal?/2`,
// which also covers a collection element (a child-table struct) and decimal
// scale.  The runtime proof is `mix test` on the generated integration test
// (and test/e2e/vo-roundtrip-elixir-vanilla.test.ts); this file pins the
// emitted shape those runs depend on.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `system Ports {
  subdomain Harbour {
    context Docking {
      enum Side { Port, Starboard }
      valueobject Coord {
        lat: decimal
        lng: decimal
      }
      valueobject Berth {
        pier: string
        position: int
        side: Side
        fee: money
        at: Coord
        maxDraft: int?
      }
      valueobject Tag {
        label: string
        side: Side
        invariant label.length > 0
      }
      aggregate Dock with crudish {
        name: string
        berth: Berth
        alt: Berth?
        tag: Tag
        mooring: Side
        stops: Coord[]
        derived atA3: bool = berth == Berth { pier: "A", position: 3, side: Port, fee: 12.50, at: Coord { lat: 1.5, lng: 2.25 } }
        derived moved: bool = alt != berth
        derived visitsOrigin: bool = stops.any(s => s == Coord { lat: 0, lng: 0 })
        function isAt(pier: string): bool = berth.equals(Berth { pier: pier, position: 3, side: Port, fee: 12.50, at: Coord { lat: 1.5, lng: 2.25 } })
      }
      repository Docks for Dock { }
      test "a loaded value object equals a constructed one" {
        let d = Dock.create(name: "x", berth: Berth { pier: "A", position: 3, side: Port, fee: 12.50, at: Coord { lat: 1.5, lng: 2.25 } }, tag: Tag { label: "t", side: Port }, mooring: Port)
        let got = Dock.findById(d.id)
        expect(got.berth == d.berth).toBe(true)
        expect(got.berth.side == Port).toBe(true)
      }
    }
  }
  api DockingApi from Harbour
  storage primary { type: postgres }
  resource dockingState { for: Docking, kind: state, use: primary }
  deployable d {
    platform: elixir
    contexts: [Docking]
    dataSources: [dockingState]
    serves: DockingApi
    port: 4000
  }
}
`;

function file(files: Map<string, string>, suffix: string): string {
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no generated file ending ${suffix}`);
  return hit[1];
}

describe("elixir vanilla: one canonical value-object shape at the column", () => {
  it("types a single-VO column as Loom.ValueObject with the declared fields", async () => {
    const files = await generateSystemFiles(SRC);
    const schema = file(files, "lib/d/docking/dock.ex");
    const berthSpec =
      '[{:pier, "pier", :string}, {:position, "position", :integer}, ' +
      '{:side, "side", {:enum, [:Port, :Starboard]}}, {:fee, "fee", :decimal}, ' +
      '{:at, "at", {:value_object, [{:lat, "lat", :decimal}, {:lng, "lng", :decimal}]}}, ' +
      '{:max_draft, "maxDraft", :integer}]';
    expect(schema).toContain(`field :berth, Loom.ValueObject, fields: ${berthSpec}`);
    // An optional VO column carries the same type — `load(nil)` is nil.
    expect(schema).toContain(`field :alt, Loom.ValueObject, fields: ${berthSpec}`);
    expect(schema).not.toMatch(/field :(berth|alt|tag), :map/);
    // The runtime module ships once per app.
    const mod = file(files, "lib/d/loom_value_object.ex");
    expect(mod).toContain("defmodule Loom.ValueObject do");
    expect(mod).toContain("use Ecto.ParameterizedType");
    expect(mod).toContain("def load(value, _loader, fields) when is_map(value)");
    expect(mod).toContain("def equal?(a, b)");
  });

  it("renders VO ==/!= (and .equals) through Loom.ValueObject.equal?/2", async () => {
    const files = await generateSystemFiles(SRC);
    const ctrl = file(files, "lib/d_web/controllers/dock_controller.ex");
    expect(ctrl).toContain('"atA3" => Loom.ValueObject.equal?(record.berth, %{pier: "A"');
    expect(ctrl).toContain('"moved" => (not Loom.ValueObject.equal?(record.alt, record.berth))');
    // A collection element is a child-table struct — the same call compares it.
    expect(ctrl).toContain(
      'Enum.any?(record.stops, fn s -> Loom.ValueObject.equal?(s, %{lat: Decimal.new("0"), lng: Decimal.new("0")}) end)',
    );
    const ctx = file(files, "lib/d/docking.ex");
    expect(ctx).toContain("(Loom.ValueObject.equal?(record.berth, %{pier: pier, position: 3");
    const test = file(files, "test/docking_integration_test.exs");
    expect(test).toContain("assert Loom.ValueObject.equal?(got.berth, d.berth) == true");
    // The canonical column loads enum values as atoms, so struct-dot reads and
    // compares the way a constructed value does.
    expect(test).toContain("assert got.berth.side == :Port == true");
    // No native `==` is left between two value objects.
    expect(`${ctrl}\n${ctx}\n${test}`).not.toMatch(/record\.berth == %\{|got\.berth == d\.berth/);
  });

  it("the VO validating constructor casts an enum field as Ecto.Enum, not :string", async () => {
    // The canonical value carries `:Port`; a `:string` cast refused the atom,
    // so every loaded or constructed Tag read as invalid.
    const files = await generateSystemFiles(SRC);
    const tag = file(files, "lib/d/docking/tag.ex");
    expect(tag).toContain(
      "side: Ecto.ParameterizedType.init(Ecto.Enum, values: [:Port, :Starboard])",
    );
  });

  it("the initial migration skips an enum check on a VO leaf (folded into the jsonb column)", async () => {
    const files = await generateSystemFiles(SRC);
    const migration = [...files.entries()].find(([p]) =>
      /priv\/repo\/migrations\/.*create_docks\.exs$/.test(p),
    )?.[1];
    expect(migration).toBeDefined();
    expect(migration).toContain("add :berth, :map");
    // `berth_side` / `alt_side` / `tag_side` are not columns on this backend.
    expect(migration).not.toMatch(/docks_(berth|alt|tag)_side_enum/);
    // A top-level enum column keeps its check.
    expect(migration).toContain("docks_mooring_enum");
  });
});
