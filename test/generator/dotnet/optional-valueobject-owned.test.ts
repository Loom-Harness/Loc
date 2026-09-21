// An OPTIONAL value-object field must take the SAME owned-type path as a
// required one — `OwnsOne`, with its flattened columns named to the migration.
//
// From `docs/audits/2026-09-10-eshop-dev-experience.md` P3.  The arm that picks
// the owned path tested `f.type.kind === "valueobject"`, and an optional field's
// `TypeIR` is an `optional` WRAPPING the valueobject — so `office: Addr?` missed
// it and fell through to the plain-scalar arm at the bottom of the function:
//
//     builder.OwnsOne<Addr>(x => x.Home, o => { … });            // required — correct
//     builder.Property(x => x.Office).HasColumnName("office");   // optional — WRONG
//
// while the migration emitted beside it creates
//
//     "home_line1"   TEXT NOT NULL,   "office_line1" TEXT NULL,
//     "home_city"    TEXT NOT NULL,   "office_city"  TEXT NULL,
//
// and no column called `office` at all.  Two independent failures in one line:
// EF cannot map a complex type as a scalar without a value converter, so the
// model fails to BUILD — which takes down every read and write of the
// aggregate, not just the optional field — and even if it could, it would be
// reading a column that does not exist.
//
// ── Why no gate saw it ──────────────────────────────────────────────────────
// Nothing in the corpus carried an optional VO.  The `optional-valueobject`
// fixture added alongside this test closes that, on all five backends; these
// assertions pin the .NET half precisely, because the failure mode is a runtime
// model-build exception rather than a compile error — `dotnet build` is green on
// the broken output, so the compile tier could never have caught it either.
//
// EF reads the optionality off the CLR navigation's nullability (`Addr? Office`
// under `<Nullable>enable</Nullable>`) and makes exactly those leaf columns
// nullable — the same inference the required side already relies on for its NOT
// NULL columns, which is why neither case configures requiredness explicitly.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SYSTEM = `
system OptVo {
  subdomain D {
    context Directory {
      valueobject Addr {
        line1: string
        city: string
      }
      aggregate Person with crudish {
        name: string
        home: Addr
        office: Addr?
      }
      repository Persons for Person { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource st { for: Directory, kind: state, use: pg }
  deployable d { platform: dotnet, contexts: [Directory], dataSources: [st], serves: A, port: 4000 }
}
`;

async function emission(): Promise<{ cfg: string; migration: string }> {
  const files = await generateSystemFiles(SYSTEM);
  const cfg = [...files].find(([p]) => p.endsWith("Configurations/PersonConfiguration.cs"))?.[1];
  expect(cfg, "no PersonConfiguration.cs emitted").toBeDefined();
  const migration = [...files].find(([p]) => p.includes("Migrations/"))?.[1];
  expect(migration, "no migration emitted").toBeDefined();
  return { cfg: cfg as string, migration: migration as string };
}

describe("dotnet — an optional value object is an OWNED type, not a scalar", () => {
  it("the optional VO takes the same OwnsOne path as the required one", async () => {
    const { cfg } = await emission();
    expect(cfg).toContain("builder.OwnsOne<Addr>(x => x.Office, o => {");
    expect(cfg).toContain('o.Property(x => x.Line1).HasColumnName("office_line1");');
    expect(cfg).toContain('o.Property(x => x.City).HasColumnName("office_city");');
  });

  it("the scalar mapping onto a column that does not exist is gone", async () => {
    const { cfg } = await emission();
    // The exact broken line.  EF throws at model build on it, so every route
    // touching Person 500s — this is the assertion that fails if the arm goes
    // back to testing the unwrapped type.
    expect(cfg).not.toContain("builder.Property(x => x.Office)");
    expect(cfg).not.toContain('HasColumnName("office")');
  });

  it("the config asks for exactly the columns the migration creates", async () => {
    // Both halves from ONE emission — what makes this a contract rather than
    // two independent guesses.  The migration is derived in phase ⑨, so this
    // needs the system pipeline, not `generateDotnet` alone.
    const { cfg, migration } = await emission();
    expect(migration).toContain("office_line1");
    expect(migration).toContain("office_city");
    // The optional group is nullable; its required sibling is not.  That
    // asymmetry is the whole reason the two paths diverged, so pin it.
    expect(migration).toMatch(/"?office_line1"?[^,]*NULL/);
    expect(migration).toMatch(/"?home_line1"?[^,]*NOT NULL/);

    for (const col of ["office_line1", "office_city"]) {
      expect(cfg, `config must name ${col}`).toContain(`HasColumnName("${col}")`);
    }
  });

  it("the REQUIRED sibling still maps as before", async () => {
    // Narrowness guard: the required path was already correct and must not move.
    const { cfg } = await emission();
    expect(cfg).toContain("builder.OwnsOne<Addr>(x => x.Home, o => {");
    expect(cfg).toContain('o.Property(x => x.Line1).HasColumnName("home_line1");');
  });
});
