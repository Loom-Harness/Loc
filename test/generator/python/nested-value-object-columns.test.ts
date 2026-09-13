// Regression (audit P11): a value object whose own field is a value object.
//
// `py-columns.columnsFor` flattens a VO field RECURSIVELY — `home: Addr` with
// `Addr.geo: Geo` becomes `home_line1` / `home_geo_lat` / `home_geo_lng`, and
// both the SQLAlchemy model and the shared Postgres DDL create exactly those.
// The repository's own flattening (`persistField` / `hydrateField`) stopped ONE
// LEVEL SHORT: it mapped the VO's fields with `persistScalar` / `hydrateScalar`,
// neither of which knows the `valueobject` kind, so it bound and read a
// `home_geo` column that exists in NEITHER the model nor the migration.
//
// That is not a type error anywhere — python is untyped at the bind site and
// `row.home_geo` is an `Any` attribute read — so nothing caught it until the
// insert hit the database.  Every read and every write of the aggregate failed
// at runtime, on the plain REQUIRED case.
//
// The assertions below are column-EXISTENCE ones: each attribute the repository
// binds or reads is checked against the columns `schema.py` actually declares,
// so a future divergence in either direction fails here rather than at runtime.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const src = (home: string, geo: string): string => `
  system S {
    subdomain D { context C {
      valueobject Geo {
        lat: decimal
        lng: decimal
      }
      valueobject Addr {
        line1: string
        geo: ${geo}
      }
      aggregate Person with crudish {
        name: string
        home: ${home}
        derived display: string = name
      }
      repository Persons for Person { }
    }}
    storage primary { type: postgres }
    resource cState { for: C, kind: state, use: primary }
    deployable api { platform: python  contexts: [C]  dataSources: [cState]  port: 3000 }
  }
`;

async function emit(home: string, geo: string): Promise<{ repo: string; schema: string }> {
  const files = await generateSystemFiles(src(home, geo));
  const pick = (suffix: string): string => {
    const k = [...files.keys()].find((key) => key.endsWith(suffix));
    expect(k, `${suffix} not emitted`).toBeDefined();
    return files.get(k!)!;
  };
  return {
    repo: pick("app/db/repositories/person_repository.py"),
    schema: pick("app/db/schema.py"),
  };
}

/** Every `<attr>: Mapped[...]` the PersonRow model declares. */
function declaredColumns(schema: string): Set<string> {
  const rows = schema.slice(schema.indexOf("class PersonRow"));
  const body = rows.slice(
    0,
    rows.indexOf("\nclass ") === -1 ? undefined : rows.indexOf("\nclass "),
  );
  return new Set([...body.matchAll(/^\s{4}(\w+): Mapped\[/gm)].map((m) => m[1]!));
}

/** Every `"<attr>":` key the save payload binds, and every `row.<attr>` the
 *  hydrate reads — the two halves that must name real columns. */
function referencedColumns(repo: string): { bound: string[]; read: string[] } {
  const root = repo.slice(repo.indexOf("root = {"), repo.indexOf("_expected ="));
  const hydrate = repo.slice(repo.indexOf("def _hydrate"));
  return {
    bound: [...root.matchAll(/"(\w+)":/g)].map((m) => m[1]!),
    read: [...new Set([...hydrate.matchAll(/\brow\.(\w+)\b/g)].map((m) => m[1]!))],
  };
}

describe("python repository — a value object inside a value object", () => {
  it("binds and reads the flattened LEAF columns, never the intermediate VO", async () => {
    const { repo, schema } = await emit("Addr", "Geo");

    // The schema (and the DDL beside it) flattens all the way down.
    expect(declaredColumns(schema)).toContain("home_geo_lat");
    expect(declaredColumns(schema)).toContain("home_geo_lng");
    expect(declaredColumns(schema)).not.toContain("home_geo");

    // The write binds the same leaves…
    expect(repo).toContain('"home_line1": aggregate.home.line1,');
    expect(repo).toContain('"home_geo_lat": Decimal(str(aggregate.home.geo.lat)),');
    expect(repo).toContain('"home_geo_lng": Decimal(str(aggregate.home.geo.lng)),');
    // …the phantom column is the exact defect, in the payload AND the upsert.
    expect(repo).not.toContain('"home_geo"');
    expect(repo).not.toContain("home_geo]");

    // …and the read reconstructs the nested VO from those leaves.
    expect(repo).toContain(
      "home=Addr(row.home_line1, Geo(float(row.home_geo_lat), float(row.home_geo_lng))),",
    );
    expect(repo).not.toContain("row.home_geo,");
    expect(repo).not.toContain("row.home_geo)");

    // The nested VO's ctor is called, so its name must be imported.
    expect(repo).toContain("from app.domain.value_objects import Addr, Geo");
  });

  it("names only columns the row model declares, on both halves", async () => {
    const { repo, schema } = await emit("Addr", "Geo");
    const declared = declaredColumns(schema);
    const { bound, read } = referencedColumns(repo);
    expect(bound.length).toBeGreaterThan(0);
    expect(read.length).toBeGreaterThan(0);
    for (const attr of bound) expect(declared, `bound column ${attr}`).toContain(attr);
    for (const attr of read) expect(declared, `read column ${attr}`).toContain(attr);
  });

  it("guards an OPTIONAL outer VO at every leaf, including the nested ones", async () => {
    const { repo, schema } = await emit("Addr?", "Geo");
    expect(declaredColumns(schema)).toContain("home_geo_lat");

    // Each leaf — nested included — is written under the outer guard.
    expect(repo).toContain(
      '"home_geo_lat": (Decimal(str(aggregate.home.geo.lat)) if aggregate.home is not None else None),',
    );
    // The read probes a leaf column, not the VO-typed field, and rebuilds the
    // whole tree inside the guard.
    expect(repo).toContain(
      "home=(Addr(row.home_line1, Geo(float(row.home_geo_lat), float(row.home_geo_lng))) if row.home_line1 is not None else None),",
    );
  });

  it("guards an OPTIONAL INNER VO on its own access, not the outer one", async () => {
    const { repo, schema } = await emit("Addr", "Geo?");
    const declared = declaredColumns(schema);
    // The outer VO is required, so its own leaf stays NOT NULL while the inner
    // group goes nullable.
    expect(schema).toContain("home_line1: Mapped[str] = mapped_column(Text)");
    expect(schema).toContain("home_geo_lat: Mapped[Decimal | None] = mapped_column(Numeric)");
    expect(declared).not.toContain("home_geo");

    // The required outer leaf is unguarded; only the inner group is.
    expect(repo).toContain('"home_line1": aggregate.home.line1,');
    expect(repo).toContain(
      '"home_geo_lat": (Decimal(str(aggregate.home.geo.lat)) if aggregate.home.geo is not None else None),',
    );
    expect(repo).toContain(
      "home=Addr(row.home_line1, (Geo(float(row.home_geo_lat), float(row.home_geo_lng)) if row.home_geo_lat is not None else None)),",
    );
  });
});
