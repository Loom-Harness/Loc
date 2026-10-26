// .NET EF × TPH × read restrictions.
//
// EF Core registers every query filter of an inheritance hierarchy on the ROOT
// entity type ("A filter may only be applied to the root entity type
// 'Vehicle'").  So a subtype's own filter is hosted there, TYPE-guarded —
// `!(x is Car) || <pred over ((Car)x)>` — which narrows Car rows and leaves
// every other row alone.  EF translates that guard (and the cast inside it,
// reading a column only Car has) when the query's source is the root set or
// `OfType<Car>()` of it; over a SIBLING's own `DbSet<Truck>` the cast fails to
// build ("No coercion operator is defined between types 'Truck' and 'Car'",
// EF Core 10.0.10).  Hence the second half of the contract, pinned by the
// census below: every read of a TPH concrete starts from the root
// (`_db.Vehicles.OfType<Car>()`), and the AppDbContext exposes no
// `DbSet<Concrete>` a read could name instead.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { generateDotnetForContexts } from "../../../src/generator/dotnet/index.js";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import type { EnrichedLoomModel } from "../../../src/ir/types/loom-ir.js";
import { isTphConcrete } from "../../../src/ir/util/inheritance.js";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { createDddServices } from "../../../src/language/ddd-module.js";
import type { Model } from "../../../src/language/generated/ast.js";
import { plural } from "../../../src/util/naming.js";

async function emit(body: string): Promise<{
  files: Map<string, string>;
  diags: ReturnType<typeof validateLoomModel>;
  loom: EnrichedLoomModel;
}> {
  const services = createDddServices(NodeFileSystem);
  const helper = parseHelper(services.Ddd);
  const doc = await helper(body, { validation: true });
  const loom = enrichLoomModel(lowerModel(doc.parseResult.value as Model));
  const diags = validateLoomModel(loom);
  const sys = loom.systems[0]!;
  const dep = sys.deployables.find((d) => d.platform === "dotnet")!;
  const contexts = sys.subdomains.flatMap((m) => m.contexts);
  const ns = dep.name[0]!.toUpperCase() + dep.name.slice(1);
  return { files: generateDotnetForContexts(contexts, ns, { deployable: dep, sys }), diags, loom };
}

/** `abstract Vehicle { name, retired }` + two concretes; `Car` carries the
 *  capability filter.  `criterionBody` picks whose column the criterion reads:
 *  a base one or `Car`'s own. */
const model = (criterionBody: string, platform = "dotnet"): string => `
  system Acme {
    subdomain Registry {
      context Fleet {
        criterion Live of Car = ${criterionBody}
        abstract aggregate Vehicle { name: string  retired: bool }
        aggregate Car extends Vehicle { doors: int  filter Live }
        aggregate Truck extends Vehicle { payloadKg: int }
        repository Cars for Car {
          find everyCar(): Car[] where this.doors >= 0 ignoring *
        }
        repository Trucks for Truck { }
      }
    }
    storage primary { type: postgres }
    resource fleetState { for: Fleet, kind: state, use: primary }
    deployable api {
      platform: ${platform}
      contexts: [Fleet]
      dataSources: [fleetState]
      port: 8080
    }
  }
`;

const fileNamed = (files: Map<string, string>, suffix: string): string =>
  [...files].find(([p]) => p.endsWith(suffix))?.[1] ?? "";

const errors = (diags: ReturnType<typeof validateLoomModel>) =>
  diags.filter((d) => d.severity === "error");

describe(".NET TPH × capability filter", () => {
  it("a subtype's filter registers on the root config, type-guarded", async () => {
    const { files, diags } = await emit(model("!this.retired"));
    expect(errors(diags)).toEqual([]);
    const baseCfg = fileNamed(files, "VehicleConfiguration.cs");
    expect(baseCfg, "the subtype's filter lands on the root config").toContain(
      'builder.HasQueryFilter("Car_LiveFilter", x => !(x is Car) || (!((Car)x).Retired));',
    );
    const carCfg = fileNamed(files, "CarConfiguration.cs");
    expect(carCfg, "concrete config emitted").not.toEqual("");
    expect(carCfg, "a TPH subtype config hosts no query filter").not.toContain("HasQueryFilter");
  });

  it("a filter reading a SUBTYPE-only column is emitted, not refused", async () => {
    const { files, diags } = await emit(model("this.doors > 0"));
    expect(errors(diags)).toEqual([]);
    expect(fileNamed(files, "VehicleConfiguration.cs")).toContain(
      'builder.HasQueryFilter("Car_LiveFilter", x => !(x is Car) || (((Car)x).Doors > 0));',
    );
  });

  it("`ignoring *` on a TPH concrete names what it drops, never every filter", async () => {
    // The parameterless `IgnoreQueryFilters()` would lift every filter the root
    // hosts — a bare `filter`, which `ignoring` cannot name, included.
    const { files } = await emit(model("this.doors > 0"));
    const cars = fileNamed(files, "Repositories/CarRepository.cs");
    expect(cars).toContain("_db.Vehicles.OfType<Car>()");
    expect(cars).not.toContain(".IgnoreQueryFilters()");
  });

  it("`softDeletable` on the BASE registers unguarded and reaches every subtype", async () => {
    const { files, diags } = await emit(`
      system Acme {
        subdomain Registry {
          context Fleet {
            abstract aggregate Vehicle with softDeletable { name: string }
            aggregate Car extends Vehicle with crudish { doors: int }
            repository Cars for Car { }
          }
        }
        storage primary { type: postgres }
        resource fleetState { for: Fleet, kind: state, use: primary }
        deployable api {
          platform: dotnet
          contexts: [Fleet]
          dataSources: [fleetState]
          port: 8080
        }
      }
    `);
    expect(errors(diags)).toEqual([]);
    expect(fileNamed(files, "VehicleConfiguration.cs")).toContain(
      'builder.HasQueryFilter("IsDeletedFilter", x => !x.IsDeleted);',
    );
  });

  it("`softDeletable` on the SUBTYPE registers guarded on the root", async () => {
    const { files, diags } = await emit(`
      system Acme {
        subdomain Registry {
          context Fleet {
            abstract aggregate Vehicle { name: string }
            aggregate Car extends Vehicle with softDeletable, crudish { doors: int }
            aggregate Truck extends Vehicle with crudish { payloadKg: int }
            repository Cars for Car {
              find withDeleted(): Car[] where this.doors >= 0 ignoring softDeletable
            }
            repository Trucks for Truck { }
          }
        }
        storage primary { type: postgres }
        resource fleetState { for: Fleet, kind: state, use: primary }
        deployable api {
          platform: dotnet
          contexts: [Fleet]
          dataSources: [fleetState]
          port: 8080
        }
      }
    `);
    expect(errors(diags)).toEqual([]);
    expect(fileNamed(files, "VehicleConfiguration.cs")).toContain(
      'builder.HasQueryFilter("Car_IsDeletedFilter", x => !(x is Car) || (!((Car)x).IsDeleted));',
    );
    expect(fileNamed(files, "Repositories/CarRepository.cs")).toContain(
      '_db.Vehicles.OfType<Car>().IgnoreQueryFilters(["Car_IsDeletedFilter"])',
    );
  });

  it("a PRINCIPAL filter on a subtype registers on the root, with distinct names per subtype", async () => {
    // Both subtypes' filters derive the same base name ("OwnerIdFilter"); on one
    // root type without a prefix the second registration would OVERWRITE the
    // first, and one subtype's isolation would vanish.
    const { files, diags } = await emit(`
      system Acme {
        user { id: guid  tenantId: string }
        subdomain Registry {
          context Fleet {
            abstract aggregate Vehicle { name: string  ownerId: string }
            aggregate Car extends Vehicle { doors: int  filter this.ownerId == currentUser.tenantId }
            aggregate Truck extends Vehicle { payloadKg: int  filter this.ownerId == currentUser.tenantId }
            repository Cars for Car { }
            repository Trucks for Truck { }
          }
        }
        storage primary { type: postgres }
        resource fleetState { for: Fleet, kind: state, use: primary }
        deployable api {
          platform: dotnet
          contexts: [Fleet]
          dataSources: [fleetState]
          port: 8080
          auth: required
        }
      }
    `);
    expect(errors(diags)).toEqual([]);
    const dbCtx = fileNamed(files, "AppDbContext.cs");
    expect(dbCtx, "no filter is registered on a derived entity type").not.toMatch(
      /modelBuilder\.Entity<(Car|Truck)>\(\)\.HasQueryFilter/,
    );
    expect(dbCtx, "Car's filter is on the root, guarded and prefixed").toContain(
      'modelBuilder.Entity<Vehicle>().HasQueryFilter("Car_OwnerIdFilter", x => !(x is Car) || (((Car)x).OwnerId == _currentUser.User.TenantId));',
    );
    expect(dbCtx, "Truck's filter is a DISTINCT key").toContain('"Truck_OwnerIdFilter"');
  });

  it("a BASE's principal filter registers once on the root and reaches every subtype", async () => {
    // An `ignoring tenantOwned` on a subtype names the root's filter, the one EF
    // actually applies.
    const { files } = await emit(`
      system Acme {
        user { id: guid  tenantId: string }
        tenancy by user.tenantId of Org
        subdomain Registry {
          context Accounts { aggregate Org { title: string } }
          context Fleet {
            abstract aggregate Vehicle with tenantOwned { name: string }
            aggregate Car extends Vehicle with tenantOwned { doors: int }
            aggregate Truck extends Vehicle { payloadKg: int }
            repository Cars for Car { }
            repository Trucks for Truck {
              find anyTenant(): Truck? where this.payloadKg > 0 ignoring tenantOwned
            }
          }
        }
        storage primary { type: postgres }
        resource fleetState { for: Fleet, kind: state, use: primary }
        resource accountsState { for: Accounts, kind: state, use: primary }
        deployable api {
          platform: dotnet
          contexts: [Fleet, Accounts]
          dataSources: [fleetState, accountsState]
          port: 8080
          auth: required
        }
      }
    `);
    const dbCtx = fileNamed(files, "AppDbContext.cs");
    expect(dbCtx, "the base's filter is registered on the root, unguarded").toContain(
      'modelBuilder.Entity<Vehicle>().HasQueryFilter("TenantIdFilter", x => x.TenantId == _currentUser.User.TenantId);',
    );
    expect(dbCtx, "no per-subtype copy of the inherited filter").not.toMatch(
      /"(Car|Truck)_TenantIdFilter"/,
    );
    expect(fileNamed(files, "Repositories/TruckRepository.cs")).toContain(
      '_db.Vehicles.OfType<Truck>().IgnoreQueryFilters(["TenantIdFilter"])',
    );
  });

  it("the polymorphic base read: a TPH reader over the root set, routed by-id and paged", async () => {
    const { files } = await emit(model("this.doors > 0"));
    expect(fileNamed(files, "Repositories/VehicleRepository.cs")).toContain(
      "_db.Vehicles.AsNoTracking().OrderBy(x => x.Id).Skip((page - 1) * pageSize).Take(pageSize)",
    );
    const ctl = fileNamed(files, "Api/VehiclesController.cs");
    expect(ctl).toContain('[Route("api/vehicles")]');
    expect(ctl).toContain('[HttpGet("{id}")]');
    expect(ctl).toContain('Car __c0 => Tagged("Car", new CarResponse(');
  });

  it("Dapper emits its own TPH reader over the shared table, routed like EF's", async () => {
    const { files } = await emit(model("this.doors > 0", "dotnet { persistence: dapper }"));
    const reader = fileNamed(files, "Repositories/VehicleRepository.cs");
    expect(reader).toContain("GetRowParser<BaseRow>");
    expect(reader).not.toContain("_db.Vehicles");
    expect(fileNamed(files, "Api/VehiclesController.cs")).toContain("GetVehicleById");
    expect(fileNamed(files, "Program.cs")).toContain("IVehicleRepository");
  });
});

// ---------------------------------------------------------------------------
// Census: no read of a TPH concrete names the concrete's own set.
//
// Over every corpus fixture with an inheritance hierarchy, generated for .NET
// EF: the AppDbContext declares no `DbSet<Concrete>` for a TPH concrete, and no
// emitted file reads `_db.<Concretes>` / `__db.<Concretes>` / `Set<Concrete>()`.
// Either would put a read where the root-hosted, type-guarded filters cannot
// translate — the shape EF answers with a failed query, or (for the set) a
// read that silently skips the restrictions a TPH filter carries.
// ---------------------------------------------------------------------------

const CORPUS = join(__dirname, "../../fixtures/corpus");
const HIERARCHY_CASES = readdirSync(CORPUS)
  .filter((f) => f.endsWith(".ddd"))
  .filter((f) => /\bextends\b/.test(readFileSync(join(CORPUS, f), "utf8")));

/** Every `_db.<Set>` / `Set<T>()` read of a TPH concrete in `files`. */
function concreteSetReads(files: Map<string, string>, loom: EnrichedLoomModel): string[] {
  const hits: string[] = [];
  for (const ctx of loom.systems.flatMap((s) => s.subdomains.flatMap((m) => m.contexts))) {
    for (const agg of ctx.aggregates) {
      if (!isTphConcrete(agg, ctx.aggregates)) continue;
      const set = plural(agg.name[0]!.toUpperCase() + agg.name.slice(1));
      const read = new RegExp(`\\b_?_db\\.${set}\\b|\\bSet<${agg.name}>\\(\\)|DbSet<${agg.name}>`);
      for (const [path, content] of files) {
        content.split("\n").forEach((line, i) => {
          if (read.test(line)) hits.push(`${path}:${i + 1}: ${line.trim()}`);
        });
      }
    }
  }
  return hits;
}

describe(".NET EF TPH read-source census", () => {
  it("covers at least the TPH corpus fixtures", () => {
    expect(HIERARCHY_CASES).toEqual(
      expect.arrayContaining([
        "tph.ddd",
        "tph-crossings.ddd",
        "inheritance-read-restrictions.ddd",
        "inheritance-base-reads.ddd",
      ]),
    );
  });

  for (const file of HIERARCHY_CASES) {
    it(`${file}: every TPH concrete read starts from its root`, async () => {
      const src = readFileSync(join(CORPUS, file), "utf8").replaceAll("__PLATFORM__", "dotnet");
      const { files, loom, diags } = await emit(src);
      expect(errors(diags), "the fixture generates on .NET").toEqual([]);
      expect(concreteSetReads(files, loom)).toEqual([]);
    });
  }
});
