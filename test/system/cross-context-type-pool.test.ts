// A `valueobject` / `enum` declared in one context and referenced from another
// is legal — the enrichment attaches `siblingValueObjects` so emitters can
// resolve the name. Three consumers were not using that pool (and for enums the
// pool did not exist at all), and each failed differently on a model that
// reports `0 error(s), 0 warning(s)`:
//
//  1. MIGRATIONS ↔ ORM, value object.  `schemaFromModule` built its VO lookup
//     from `module.contexts` — but migrations are derived per MODULE, so a VO
//     declared in another SUBDOMAIN was not there. A missed VO does not fail
//     loudly: it falls through to one `json` column, while every relational ORM
//     emitter (which resolves against the whole model) flattens it. The
//     migration created `"spot" JSONB`; the ORM then queried `spot_value`, a
//     column that did not exist:
//
//       Failed query: select "id", "spot_value", … from "consumer"."aways"
//       → HTTP 500 on every read and write of that aggregate
//
//  2. MIGRATIONS, enum.  Same lookup, same scope — a cross-context enum
//     silently lost its `CHECK (<col> IN (...))` constraint.
//
//  3. NODE ROUTES, enum.  `collectUsedEnums` filtered `ctx.enums`, which is what
//     MINTS the route file's `const <E>Schema = z.enum([...])`. Cross-context,
//     the declaration was dropped while the request/response schemas kept
//     referencing the name — `ReferenceError: GradeSchema is not defined` at
//     module load, so the api process EXITED ON BOOT.
//
// Fixed by giving enums the pool value objects already had (`siblingEnums` +
// `enumPool`, mirroring `siblingValueObjects` + `valueObjectPool`) and routing
// all three consumers through the pools.
//
// Proven at runtime against a booted stack: `GET /api/aways` 200,
// `POST /api/aways` 201 with the nested VO read back, a bad enum value
// rejected 422, and `information_schema` reporting `spot_value | text`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SRC = `
system VoXCtx {
  subdomain S1 {
    context Owner {
      valueobject Code { value: string }
      enum Grade { A, B }
      aggregate Home with crudish { spot: Code  g: Grade }
      repository RH for Home { }
    }
  }
  subdomain S2 {
    context Consumer {
      aggregate Away with crudish { spot: Code  g: Grade }
      repository RA for Away { }
    }
  }
  storage primary { type: postgres }
  resource s1 { for: Owner, kind: state, use: primary }
  resource s2 { for: Consumer, kind: state, use: primary }
  deployable api {
    platform: node
    contexts: [Owner, Consumer]
    dataSources: [s1, s2]
    port: 3000
  }
}
`;

function bySuffix(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending in ${suffix}`);
  return files.get(key)!;
}

function migrationSql(files: Map<string, string>): string {
  return [...files.entries()]
    .filter(([k]) => k.includes("db/migrations/") && k.endsWith(".sql"))
    .map(([, v]) => v)
    .join("\n");
}

describe("a value object / enum from a sibling context resolves for every emitter", () => {
  it("the migration flattens the cross-context VO the same way the ORM does", async () => {
    const files = await generateSystemFiles(SRC);
    const sql = migrationSql(files);
    const orm = bySuffix(files, "db/schema.ts");

    // The OWN-context table is the control: it was always right, so a
    // regression that broke both would still fail this test.
    expect(sql, "owner.homes should flatten the VO").toContain('"spot_value" TEXT');
    // The cross-context table is the defect.
    expect(
      sql.match(/"spot_value" TEXT/g)?.length ?? 0,
      'both tables must flatten `spot` — a JSONB "spot" column is the defect',
    ).toBe(2);
    expect(sql, "the VO must not collapse to one json column").not.toContain('"spot" JSONB');

    // …and the ORM must agree, which is the whole point: these two artifacts
    // describe the same table and disagreed at runtime.
    expect(orm.match(/spot_value: text\("spot_value"\)/g)?.length ?? 0).toBe(2);
  });

  it("the cross-context enum keeps its CHECK constraint", async () => {
    const files = await generateSystemFiles(SRC);
    const sql = migrationSql(files);
    expect(sql, "own-context enum CHECK").toContain(`CONSTRAINT "homes_g_enum"`);
    expect(sql, "cross-context enum lost its CHECK").toContain(`CONSTRAINT "aways_g_enum"`);
  });

  it("the route file declares the cross-context enum schema it references", async () => {
    const files = await generateSystemFiles(SRC);
    const away = bySuffix(files, "http/away.routes.ts");
    // Vacuity guard: the reference is what makes the declaration mandatory.
    expect(away, "the route should reference the enum schema").toContain("g: GradeSchema");
    expect(
      away,
      "GradeSchema is referenced but never declared — ReferenceError at module load",
    ).toContain('const GradeSchema = z.enum(["A", "B"])');
  });
});

// 4. NODE DOMAIN / REPOSITORY / UNIT TESTS, enum (claims D1).  The per-aggregate
//    domain module, its drizzle repository and its unit-test file each picked
//    their `value-objects` import candidates from `ctx.enums` — so a field typed
//    by a sibling context's enum kept its `Grade` annotations and lost the
//    import (tsc TS2304 in all three files).  A test body's bare `A` now
//    lowers to `Grade.A` (lowering's sibling-enum fallback); the test file must
//    then also IMPORT `Grade`, or the qualified value is an undefined name — a
//    `ReferenceError` that a `toThrow()` test happily counts as a pass.
const SRC_TESTS = `
system EnumXCtx {
  subdomain S1 {
    context Owner {
      enum Grade { A, B }
      aggregate Home with crudish { name: string }
      repository RH for Home { }
    }
  }
  subdomain S2 {
    context Consumer {
      aggregate Away with crudish {
        g: Grade
        title: string
        invariant title.length > 2
        test "neg" { expect(Away.create(g: A, title: "x")).toThrow() }
        test "pos" { let a = Away.create(g: Grade.B, title: "abc")  expect(a.g).toBe(B) }
      }
      repository RA for Away { find byGrade(k: Grade): Away? where this.g == k }
    }
  }
  storage primary { type: postgres }
  resource s1 { for: Owner, kind: state, use: primary }
  resource s2 { for: Consumer, kind: state, use: primary }
  deployable api {
    platform: node
    contexts: [Owner, Consumer]
    dataSources: [s1, s2]
    port: 3000
  }
}
`;

describe("a sibling-context enum is imported by the node domain / repository / unit tests", () => {
  it("the domain module and its repository import the enum they annotate with", async () => {
    const files = await generateSystemFiles(SRC_TESTS);
    const domain = bySuffix(files, "domain/away.ts");
    const repo = bySuffix(files, "db/repositories/away-repository.ts");
    // Vacuity guards: the annotation is what makes the import mandatory.
    expect(domain).toMatch(/\bg: Grade\b/);
    expect(repo).toMatch(/: Grade\b/);
    expect(domain, "domain/away.ts names Grade without importing it").toContain(
      'import type { Grade } from "./value-objects";',
    );
    expect(repo, "the repository names Grade without importing it").toContain(
      'import type { Grade } from "../../domain/value-objects";',
    );
  });

  it("a unit-test body's bare and qualified sibling enum values resolve and are imported", async () => {
    const files = await generateSystemFiles(SRC_TESTS);
    const test = bySuffix(files, "domain/away.test.ts");
    expect(test, "bare `A` must lower to the qualified value").toContain(
      'Away.create({ g: Grade.A, title: "x" })',
    );
    expect(test, "qualified `Grade.B` must resolve").toContain(
      'Away.create({ g: Grade.B, title: "abc" })',
    );
    expect(test, "bare `B` in a matcher must lower to the qualified value").toContain(
      "toBe(Grade.B)",
    );
    expect(test, "the test file names Grade without importing it").toContain(
      'import { Grade } from "./value-objects";',
    );
  });
});
