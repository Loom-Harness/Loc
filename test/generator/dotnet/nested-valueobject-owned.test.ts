// dotnet — a value object whose OWN field is a value object (audit P11, the
// half that was UNSETTLED rather than broken).
//
// `ownedVoLines` recurses with the builder lambda parameter hard-coded to `o`
// (`efcore.ts`, the `base.kind === "valueobject"` arm), so a VO inside a VO
// emits an inner `o => { … }` nested INSIDE the enclosing `o => { … }`:
//
//     builder.OwnsOne<Addr>(x => x.Home, o => {
//         o.Property(x => x.Line1).HasColumnName("home_line1");
//         o.OwnsOne<Geo>(x => x.Geo, o => {
//             o.Property(x => x.Lat).HasColumnName("home_geo_lat");
//         });
//     });
//
// The audit read that as CS0136 ("a local or parameter named 'o' cannot be
// declared in this scope because that name is used in an enclosing local
// scope") and could not settle it — that host had no .NET SDK.
//
// SETTLED, EMPIRICALLY, AND THE READING WAS WRONG.  The `nested-valueobject`
// corpus fixture's generated project was built with `dotnet build /warnaserror`
// on `mcr.microsoft.com/dotnet/sdk:10.0` (the image the emitted Dockerfile
// targets): "Build succeeded. 0 Warning(s) 0 Error(s)".  A minimal repro of the
// bare shape — `Run(o => { Run(o => { … }); })` — builds clean too, so it is the
// SHADOWING that is legal on this language version, not something about EF's
// overloads rescuing it.  No emitter change is warranted, and threading a fresh
// parameter name per depth would be churn with no defect behind it.
//
// The shape was in fact already shipping before this fixture existed: a value
// object on a CONTAINMENT part emits `o.OwnsOne<Money>(…, o => { … })` inside
// `builder.OwnsMany<OrderLine>("_lines", o => { … })` — asserted by
// `part-valueobject-columns.test.ts` and compiled by the corpus every run.
//
// What is NOT settled by that and so is pinned here: the nested group's COLUMN
// NAMES.  `ownedVoLines` passes the accumulated `col` down as the next prefix,
// so the leaves must come out `home_geo_lat` / `home_geo_lng` — the same names
// the shared MigrationsIR DDL creates.  A recursion that reset the prefix (or
// stopped one level short, which is exactly what the python repository did)
// would map columns the migration never creates, and EF would fail to build the
// model at runtime with the project still compiling green.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SYSTEM = `
system S {
  subdomain D {
    context Directory {
      valueobject Geo { lat: decimal  lng: decimal }
      valueobject Addr { line1: string  geo: Geo }
      aggregate Person {
        name: string
        home: Addr
      }
      repository Persons for Person { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource dState { for: Directory, kind: state, use: pg }
  deployable d { platform: dotnet, contexts: [Directory], dataSources: [dState], serves: A, port: 4000 }
}
`;

/** The EF configuration and the migration DDL from ONE system emission — the
 *  two halves have to agree, and reading them from the same run is what makes
 *  this a CONTRACT rather than two independent guesses about the prefix the
 *  owned recursion accumulates.  Migrations are derived in phase ⑨
 *  (`buildMigrations`), so this needs the system pipeline. */
async function emitted(): Promise<{ cfg: string; migration: string }> {
  const files = await generateSystemFiles(SYSTEM);
  const cfg = [...files].find(([p]) => p.endsWith("Configurations/PersonConfiguration.cs"))?.[1];
  expect(cfg, "PersonConfiguration.cs not emitted").toBeDefined();
  const migration = [...files].find(([p]) => p.includes("Migrations/"))?.[1];
  expect(migration, "no migration emitted").toBeDefined();
  return { cfg: cfg as string, migration: migration as string };
}

describe("dotnet — a value object inside a value object", () => {
  it("nests the owned builder and names the leaf columns by the full path", async () => {
    const { cfg } = await emitted();
    expect(cfg).toContain("builder.OwnsOne<Addr>(x => x.Home, o => {");
    expect(cfg).toContain('o.Property(x => x.Line1).HasColumnName("home_line1");');
    // The nested VO takes the owned path too — not a scalar `Property`.
    expect(cfg).toContain("o.OwnsOne<Geo>(x => x.Geo, o => {");
    // …and its leaves carry the ACCUMULATED prefix, matching the migration.
    expect(cfg).toContain('o.Property(x => x.Lat).HasColumnName("home_geo_lat");');
    expect(cfg).toContain('o.Property(x => x.Lng).HasColumnName("home_geo_lng");');
    // The intermediate VO is never a column of its own.
    expect(cfg).not.toContain('HasColumnName("home_geo")');
    expect(cfg).not.toContain("Property(x => x.Geo)");
  });

  it("does not fall back to the unnamed overload at either level", async () => {
    const { cfg } = await emitted();
    // With no column names EF defaults to `Home_Geo_Lat`, which no migration
    // creates — the model then builds but every read/write misses.
    expect(cfg).not.toContain("builder.OwnsOne<Addr>(x => x.Home);");
    expect(cfg).not.toContain("o.OwnsOne<Geo>(x => x.Geo);");
  });

  it("the nested column names match what the migration actually creates", async () => {
    const { cfg, migration } = await emitted();
    expect(migration).toContain("home_geo_lat");
    expect(migration).toContain("home_geo_lng");
    // The intermediate VO is not a column, at either spelling.
    expect(migration).not.toContain('"home_geo"');
    expect(migration).not.toContain("Home_Geo_Lat");

    // Same run, both halves: the EF config in THIS system emission asks for the
    // very columns the migration above creates.
    expect(cfg).toContain('o.Property(x => x.Lat).HasColumnName("home_geo_lat");');
  });
});
