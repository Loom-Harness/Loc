import { describe, expect, it } from "vitest";
import {
  CS_IMPLICIT_USINGS,
  csNsRef,
  csRef,
  csUsing,
  finalizeCsUnit,
} from "../../../src/generator/_imports/dotnet.js";
import { DotnetOutputMap } from "../../../src/generator/dotnet/cs-output.js";
import { generateCorpusCase } from "../../fixtures/corpus/harness.js";

// Imports derived from use — the C# finalizer.  The header's own order is
// kept; a `csUsing` slot renders iff a surviving marker names its namespace.

const unit = (...lines: string[]): string => lines.join("\n");
const REGEX = csRef("System.Text.RegularExpressions", "Regex");

describe("finalizeCsUnit — slots", () => {
  it("a slot renders in place iff the text references its namespace", () => {
    const header = (body: string): string =>
      unit(
        "// Auto-generated.",
        "using Mediator;",
        csUsing("System.Text.RegularExpressions"),
        "using D.Domain.Ids;",
        "",
        "namespace D.Domain.X;",
        "",
        body,
      );
    expect(finalizeCsUnit(header(`var ok = ${REGEX}.IsMatch(s, "^a$");`))).toBe(
      unit(
        "// Auto-generated.",
        "using Mediator;",
        "using System.Text.RegularExpressions;",
        "using D.Domain.Ids;",
        "",
        "namespace D.Domain.X;",
        "",
        'var ok = Regex.IsMatch(s, "^a$");',
      ),
    );
    expect(finalizeCsUnit(header("var ok = true;"))).toBe(
      unit(
        "// Auto-generated.",
        "using Mediator;",
        "using D.Domain.Ids;",
        "",
        "namespace D.Domain.X;",
        "",
        "var ok = true;",
      ),
    );
  });

  it("a slot renders for an implicit namespace too (the header asked for it)", () => {
    const out = finalizeCsUnit(
      unit(
        csUsing("System.Linq"),
        "",
        "namespace N;",
        `class A { int[] x = y${csNsRef("System.Linq")}.ToArray(); }`,
      ),
    );
    expect(out).toBe(
      unit("using System.Linq;", "", "namespace N;", "class A { int[] x = y.ToArray(); }"),
    );
  });

  it("a namespace-only reference spells as nothing", () => {
    const out = finalizeCsUnit(
      unit(csUsing("Dapper"), "", `x = conn${csNsRef("Dapper")}.QueryAsync<T>(sql);`),
    );
    expect(out).toBe(unit("using Dapper;", "", "x = conn.QueryAsync<T>(sql);"));
  });

  it("two slots for one namespace render one line; a hand-written line wins", () => {
    expect(
      finalizeCsUnit(
        unit(
          csUsing("Npgsql"),
          csUsing("Npgsql"),
          "",
          `${csRef("Npgsql", "NpgsqlDataSource")} db;`,
        ),
      ),
    ).toBe(unit("using Npgsql;", "", "NpgsqlDataSource db;"));
    expect(
      finalizeCsUnit(
        unit("using Npgsql;", csUsing("Npgsql"), "", `${csRef("Npgsql", "NpgsqlDataSource")} db;`),
      ),
    ).toBe(unit("using Npgsql;", "", "NpgsqlDataSource db;"));
  });
});

describe("finalizeCsUnit — derived lines without a slot", () => {
  it("lands after the leading region's last plain using, before alias lines", () => {
    const out = finalizeCsUnit(
      unit(
        "// Auto-generated.",
        "using Mediator;",
        "using Task = D.Domain.Tasks.Task;",
        "",
        "namespace D.Application;",
        "",
        `var ok = ${REGEX}.IsMatch(s, p);`,
      ),
    );
    expect(out).toBe(
      unit(
        "// Auto-generated.",
        "using Mediator;",
        "using System.Text.RegularExpressions;",
        "using Task = D.Domain.Tasks.Task;",
        "",
        "namespace D.Application;",
        "",
        "var ok = Regex.IsMatch(s, p);",
      ),
    );
  });

  it("with no using at all, goes above the first declaration", () => {
    expect(
      finalizeCsUnit(unit("// Auto-generated.", "", "namespace N;", `class A { ${REGEX} r; }`)),
    ).toBe(
      unit(
        "// Auto-generated.",
        "",
        "using System.Text.RegularExpressions;",
        "",
        "namespace N;",
        "class A { Regex r; }",
      ),
    );
  });

  it("an implicit (SDK) namespace, the unit's own and an enclosing one need no line", () => {
    expect(CS_IMPLICIT_USINGS.has("System.Linq")).toBe(true);
    const out = finalizeCsUnit(
      unit(
        "using Mediator;",
        "",
        "namespace D.Domain.Orders;",
        `class A { ${csRef("System", "DateTime")} t; ${csRef("D.Domain.Orders", "Line")} l; ${csRef("D.Domain", "Marker")} m; }`,
      ),
    );
    expect(out).toBe(
      unit(
        "using Mediator;",
        "",
        "namespace D.Domain.Orders;",
        "class A { DateTime t; Line l; Marker m; }",
      ),
    );
  });

  it("an aliased handle derives `using Alias = Ns.Name;`", () => {
    const out = finalizeCsUnit(
      unit(
        "using Mediator;",
        "",
        "namespace N;",
        `class A { ${csRef("D.Domain.Tasks", "Task", "DomainTask")} t; }`,
      ),
    );
    expect(out).toBe(
      unit(
        "using Mediator;",
        "using DomainTask = D.Domain.Tasks.Task;",
        "",
        "namespace N;",
        "class A { DomainTask t; }",
      ),
    );
  });

  it("two unaliased types sharing a simple name across namespaces throw", () => {
    expect(() =>
      finalizeCsUnit(
        unit(
          "namespace N;",
          `${csRef("A.B", "Task")} x; ${csRef("System.Threading.Tasks", "Task")} y;`,
        ),
      ),
    ).toThrow(/two references spell 'Task'/);
  });

  it("a unit with no marker and no slot is returned unchanged", () => {
    const text = unit("using System;", "", "namespace N;", "class A {}");
    expect(finalizeCsUnit(text)).toBe(text);
  });
});

describe("DotnetOutputMap", () => {
  it("finalizes every .cs write and leaves other files alone", () => {
    const out = new DotnetOutputMap("test");
    out.set("A.cs", unit(csUsing("System.Text.RegularExpressions"), "", `${REGEX} r;`));
    const raw = `<!-- ${csUsing("X")} -->`;
    out.set("A.csproj", raw);
    expect(out.get("A.cs")).toBe(unit("using System.Text.RegularExpressions;", "", "Regex r;"));
    expect(() => out.assertFinal()).toThrow(/A\.csproj:1: unresolved import marker/);
  });

  it("no generated corpus file carries a marker (generation asserts it)", async () => {
    for (const id of ["vo-regex-invariant", "seed-values", "channels-broker"]) {
      for (const persistence of ["efcore", "dapper"]) {
        const files = await generateCorpusCase(id, "dotnet", persistence);
        for (const [path, content] of files) {
          if (path.endsWith(".cs")) expect(content, path).not.toMatch(/[]/);
        }
      }
    }
  });
});
