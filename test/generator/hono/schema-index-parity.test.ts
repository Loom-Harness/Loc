// The Drizzle `schema.ts` and the shared migration chain must agree on the
// index set.  Loom auto-emits no performance index for a find's filter columns
// (D-INDEX-SUGGEST), so a schema index named after a filtered column is one no
// migration creates — `drizzle-kit generate`/`push` then diverges from the
// migrated database.  The plain indexes both sides carry are the FK covering
// indexes on `X id` columns.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = `
system Acme {
  subdomain People {
    context Staff {
      aggregate Team { name: string }
      repository Teams for Team { }
      aggregate Employee {
        name: string
        kind: string
        badge: string
        team: Team id
        mentor: Team id?
        unique (badge)
      }
      repository Employees for Employee {
        find byKind(kind: string): Employee[]
        find seniors(k: string): Employee[] where this.kind == k && this.name == "x"
        find byTeam(team: Team id): Employee[]
      }
    }
  }
  api PeopleApi from People
  storage primarySql { type: postgres }
  resource sState { for: Staff, kind: state, use: primarySql }
  deployable api {
    platform: node
    contexts: [Staff]
    dataSources: [sState]
    serves: PeopleApi
    port: 3001
  }
}
`;

/** Every index NAME a migration file creates (`CREATE [UNIQUE] INDEX <name>`). */
function migrationIndexNames(files: Map<string, string>): Set<string> {
  const out = new Set<string>();
  for (const [path, body] of files) {
    if (path.endsWith("db/schema.ts")) continue;
    for (const m of body.matchAll(/CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?"?([a-z0-9_]+)"?/g)) {
      out.add(m[1]!);
    }
  }
  return out;
}

describe("hono drizzle schema — index set matches the migrations", () => {
  it("declares only indexes a migration creates, and every root FK index", async () => {
    const files = await generateSystemFiles(SRC);
    const schema = [...files.entries()].find(([p]) => p.endsWith("db/schema.ts"))?.[1];
    expect(schema, "db/schema.ts").toBeDefined();
    const migrated = migrationIndexNames(files);
    expect(migrated.size, "migration CREATE INDEX statements").toBeGreaterThan(0);

    const declared = [...schema!.matchAll(/\b(?:index|uniqueIndex)\("([a-z0-9_]+)"\)/g)].map(
      (m) => m[1]!,
    );
    expect(declared.filter((n) => !migrated.has(n))).toEqual([]);

    // Find-filter columns carry no index on either side.
    expect(schema).not.toContain('"employees_kind_idx"');
    expect(schema).not.toContain('"employees_name_idx"');
    // The FK covering indexes do — including an FK no find filters on.
    expect(declared).toContain("employees_team_idx");
    expect(declared).toContain("employees_mentor_idx");
    expect(declared).toContain("employees_badge_uq");
  });

  it("the EF model's HasIndex set is the same FK set on dotnet", async () => {
    const files = await generateSystemFiles(
      SRC.replace("platform: node", "platform: dotnet").replace("port: 3001", "port: 5000"),
    );
    const cfg = [...files.entries()].find(([p]) => p.endsWith("EmployeeConfiguration.cs"))?.[1];
    expect(cfg, "EmployeeConfiguration.cs").toBeDefined();
    const hasIndex = [...cfg!.matchAll(/builder\.HasIndex\(x => x\.(\w+)\)/g)].map((m) => m[1]);
    expect(hasIndex.sort()).toEqual(["Mentor", "Team"]);
  });
});
