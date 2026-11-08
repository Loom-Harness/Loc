import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/index.js";

// ---------------------------------------------------------------------------
// `version` is ordinary domain data; the concurrency counter is `rowVersion`.
//
// `applyDefaultVersioning` splices the `versioned` capability (`rowVersion:
// int token = 1`, column `row_version`) into every non-eventLog aggregate.  The
// counter used to be named `version`, so a domain field of that name silently
// shared the concurrency column: an `int` one drifted on every save (a rule
// set's `version: int immutable = 1` read back as 3 after a few edits), and a
// `string` one emitted `"version" TEXT NOT NULL DEFAULT 1`, which Postgres
// rejects.  Now `version` is plain data of any type, and only a field that
// lands on the counter's own member or column is refused — except the exact
// `rowVersion: int` the capability itself splices, which is what the
// structural printer / "unfold macro" ejects for an expanded aggregate and so
// has to re-parse.
// ---------------------------------------------------------------------------

const system = (field: string) => `
system Probe {
  subdomain Ops {
    context Ops {
      aggregate Release with crudish {
        ${field}
        notes: string
      }
      repository Releases for Release { }
    }
  }
  api OpsApi from Ops
  storage primary { type: postgres }
  resource opsState { for: Ops, kind: state, use: primary }
  deployable svc {
    platform: node
    contexts: [Ops]
    dataSources: [opsState]
    serves: OpsApi
    port: 4000
  }
}
`;

describe("a user `version` field is plain data", () => {
  for (const type of ["int immutable = 1", "string", "decimal"]) {
    it(`accepts \`version: ${type}\` and keeps the counter on its own column`, async () => {
      const files = await generateSystemFiles(system(`version: ${type}`));
      const sql = [...files].find(([p]) => p.endsWith("_ops_initial.sql"))?.[1] ?? "";
      expect(sql).toContain(`"row_version" INTEGER NOT NULL DEFAULT 1`);
      expect(sql).not.toContain(`"version" INTEGER NOT NULL DEFAULT 1`);
      const repo = files.get("svc/db/repositories/release-repository.ts") ?? "";
      // The read/compare/bump names the counter, never the user's field.
      expect(repo).toContain("const expected = expectedVersion ?? aggregate.rowVersion;");
      expect(repo).toContain("rowVersion: expected + 1");
      expect(repo).not.toMatch(/\bversion: expected/);
    });
  }

  it("leaves an aggregate with no such field on the normal splice path", async () => {
    const files = await generateSystemFiles(system(""));
    const sql = [...files].find(([p]) => p.endsWith("_ops_initial.sql"))?.[1] ?? "";
    expect(sql).toContain(`"row_version" INTEGER NOT NULL DEFAULT 1`);
    expect(sql).not.toMatch(/"version"/);
  });
});

describe("loom.version-field-collision — a field on the counter's member or column", () => {
  for (const field of [
    "rowVersion: string",
    "rowVersion: int?",
    "row_version: int",
    "RowVersion: int",
  ]) {
    it(`refuses \`${field}\` (default-on versioning)`, async () => {
      const { errors } = await parseString(system(field));
      const name = field.split(":")[0];
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain(
        `field '${name}' on aggregate 'Release' collides with Loom's optimistic-concurrency counter 'rowVersion' (column 'row_version')`,
      );
      // Actionable: it names both ways out.
      expect(errors[0]).toContain("'version' is an ordinary field name");
      expect(errors[0]).toContain("declare it 'rowVersion: int'");
    });
  }

  const src = (field: string, caps: string) => `
    system S {
      subdomain Sub { context Ops {
        aggregate Release ${caps} {
          ${field}
          name: string
        }
        repository Releases for Release { }
      } }
    }
  `;

  it("refuses it when the capability was asked for by name — once, not twice", async () => {
    const { errors } = await parseString(src("rowVersion: string", "with crudish, versioned"));
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/field 'rowVersion' on aggregate 'Release' collides/);
  });

  it("refuses it through a context-level application too", async () => {
    const { errors } = await parseString(`
      system S {
        subdomain Sub { context Ops with versioned {
          aggregate Release with crudish {
            rowVersion: string
            name: string
          }
          repository Releases for Release { }
        } }
      }
    `);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/field 'rowVersion' on aggregate 'Release' collides/);
  });

  it("accepts the exact spliced shape `rowVersion: int` — what unfold ejects — as the counter", async () => {
    const files = await generateSystemFiles(system("rowVersion: int"));
    const sql = [...files].find(([p]) => p.endsWith("_ops_initial.sql"))?.[1] ?? "";
    expect(sql).toContain(`"row_version" INTEGER NOT NULL DEFAULT 1`);
    const repo = files.get("svc/db/repositories/release-repository.ts") ?? "";
    expect(repo).toContain("rowVersion: expected + 1");
    const { errors } = await parseString(src("rowVersion: int", "with crudish, versioned"));
    expect(errors).toEqual([]);
  });

  it("does not fire on an event-sourced aggregate, which carries no counter", async () => {
    // AST-phase errors only (`parseString`); the IR-phase "no backend hosts
    // this event-sourced context" refusal is unrelated to the counter.
    const { errors } = await parseString(src("rowVersion: int", "persistedAs: eventLog"));
    expect(errors).toEqual([]);
  });
});
