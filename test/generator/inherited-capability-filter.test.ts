// A capability on an abstract base applies to every concrete subtype
// (D-INHERITED-CAPABILITIES).  `Truck extends Vehicle`, `Vehicle with
// softDeletable`: every Truck read must hide soft-deleted rows, and
// `ignoring softDeletable` on a Truck find must lift exactly that filter.
//
// The base's filter used to reach no concrete on node, python, java, elixir or
// Dapper — the subtype carried the `is_deleted` column and nothing read it —
// and `ignoring softDeletable` on the concrete was refused as an unknown
// capability.  The merge happens once in the IR (`inheritBaseCapabilities`),
// so each backend below is asserting the same IR fact through its own
// emitter.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

type Layout = "sharedTable" | "ownTable";

function model(platform: string, layout: Layout, extra = ""): string {
  return `
system Fleets {
  subdomain D {
    context Fleet {
      abstract aggregate Vehicle inheritanceUsing: ${layout} with softDeletable {
        name: string
        plate: string
      }
      aggregate Car extends Vehicle { seats: int }
      aggregate Truck extends Vehicle { payload: int }
      repository Cars for Car { }
      repository Trucks for Truck {
        find byPlateAll(plate: string): Truck[] where this.plate == plate ignoring softDeletable
      }
      ${extra}
    }
  }
  storage primary { type: postgres }
  resource fleetState { for: Fleet, kind: state, use: primary }
  deployable api { platform: ${platform} contexts: [Fleet] dataSources: [fleetState] port: 3000 }
}`;
}

async function gen(platform: string, layout: Layout): Promise<Map<string, string>> {
  const files = await generateSystemFiles(model(platform, layout));
  return new Map([...files].map(([k, v]) => [k.replace(/^api\//, ""), v]));
}

const file = (files: Map<string, string>, suffix: string): string => {
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  expect(hit, `${suffix} emitted`).toBeDefined();
  return hit![1];
};

/** The single emitted line that contains every one of `needles`. */
const lineWith = (src: string, ...needles: string[]): string => {
  const hits = src.split("\n").filter((l) => needles.every((n) => l.includes(n)));
  expect(hits, `exactly one line containing ${needles.join(" + ")}`).toHaveLength(1);
  return hits[0]!;
};

describe.each<Layout>(["sharedTable", "ownTable"])("inherited softDeletable — %s", (layout) => {
  const tph = layout === "sharedTable";
  const table = tph ? "vehicles" : "trucks";

  it("node (drizzle)", async () => {
    const repo = file(await gen("node", layout), "db/repositories/truck-repository.ts");
    expect(lineWith(repo, "rootRows", `inArray(schema.${table}.id, ids)`)).toContain(
      `not(eq(schema.${table}.isDeleted, true))`,
    );
    expect(lineWith(repo, `schema.${table}.plate, plate`)).not.toContain("isDeleted");
  });

  it("node (mikroorm)", async () => {
    const repo = file(
      await gen("node { persistence: mikroorm }", layout),
      "db/repositories/truck-repository.ts",
    );
    expect(lineWith(repo, "em.find(", "{ id: { $in: ids")).toContain("{ isDeleted: false }");
    expect(lineWith(repo, "{ plate: plate }")).not.toContain("isDeleted");
  });

  it("python (sqlalchemy)", async () => {
    const files = await gen("python", layout);
    // The read-scope hook hosts the base's filter: on the root row class
    // under TPH (it reaches every subclass), on Truck's own row under TPC.
    const host = layout === "sharedTable" ? "VehicleRow" : "TruckRow";
    const scope = file(files, "app/db/read_scope.py");
    expect(scope).toContain(
      `out.append(with_loader_criteria(${host}, lambda cls: not_(cls.is_deleted), include_aliases=True))`,
    );
    expect(scope).toContain('if not _bypassed("softDeletable", ignoring):');
    const repo = file(files, "db/repositories/truck_repository.py");
    expect(lineWith(repo, ".plate == plate")).toContain(
      'loom_ignoring=frozenset({"softDeletable"})',
    );
  });

  it("elixir (ecto)", async () => {
    const repo = file(await gen("elixir", layout), "fleet/truck_repository.ex");
    expect(lineWith(repo, "Repo.one(", "record.id == ^id")).toContain("not record.is_deleted");
    expect(lineWith(repo, "record.plate == ^plate")).not.toContain("is_deleted");
  });

  it("java (hibernate)", async () => {
    const files = await gen("java", layout);
    // Truck has a read that bypasses the filter, so it renders as a named,
    // auto-enabled Hibernate filter rather than an unconditional restriction.
    expect(file(files, "trucks/Truck.java")).toContain(
      '@Filter(name = "softDeletable", condition = "not (is_deleted)")',
    );
    const impl = file(files, "trucks/TruckRepositoryImpl.java");
    expect(impl).toContain('__session.disableFilter("softDeletable");');
    // Car never bypasses it: an unconditional restriction, kind-guarded on the
    // shared table under TPH.
    const carHost = tph ? file(files, "vehicles/Vehicle.java") : file(files, "cars/Car.java");
    expect(carHost).toContain(
      tph
        ? `@SQLRestriction("(kind <> 'Car' or (not (is_deleted)))")`
        : `@SQLRestriction("not (is_deleted)")`,
    );
  });

  it(".NET (dapper)", async () => {
    const repo = file(
      await gen("dotnet { persistence: dapper }", layout),
      "Infrastructure/Repositories/TruckRepository.cs",
    );
    // The SELECT list names `is_deleted` either way; only the WHERE clause counts.
    const where = (l: string): string => l.slice(l.indexOf(" WHERE "));
    expect(where(lineWith(repo, "WHERE id = @id"))).toContain("(NOT is_deleted)");
    expect(where(lineWith(repo, "(plate = @plate)"))).not.toContain("is_deleted");
  });

  it(".NET (ef core)", async () => {
    const files = await gen("dotnet", layout);
    const repo = file(files, "Infrastructure/Repositories/TruckRepository.cs");
    // The bypass names the filter EF actually registered — under TPH that is
    // the root's own `IsDeletedFilter`, not a `Truck_`-prefixed copy, which
    // would leave the root's filter active.
    expect(lineWith(repo, "x.Plate == plate")).toContain('IgnoreQueryFilters(["IsDeletedFilter"])');
    if (tph) {
      const root = file(files, "Configurations/VehicleConfiguration.cs");
      expect(root).toContain('builder.HasQueryFilter("IsDeletedFilter", x => !x.IsDeleted);');
      // Registered once on the root, never re-registered per concrete.
      expect(root).not.toContain("Truck_IsDeletedFilter");
      expect(root).not.toContain("Car_IsDeletedFilter");
    } else {
      for (const c of ["Car", "Truck"]) {
        expect(file(files, `Configurations/${c}Configuration.cs`)).toContain(
          'builder.HasQueryFilter("IsDeletedFilter", x => !x.IsDeleted);',
        );
      }
    }
  });
});
