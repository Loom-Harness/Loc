// Entity history on .NET / ASP.NET + Mediator — the read side of the `audited`
// trail (docs/audit.md).  The RUNTIME contract is proven by the behavioral leg
// (`node run-dotnet.mjs audit-history audit-history-guarded` diffs the booted
// app's responses against the node-minted wire goldens), and
// `dotnet build /warnaserror` proves the emitted project is sound.  The guards'
// runtime claims — mask drop, the inherited gate's 403 ahead of the row lookup,
// stamps out of the diff, no route when unaudited — are on that wire
// (`audit-history-guarded`); this suite keeps what it cannot see.

import { describe, expect, it } from "vitest";
import { generateSystems } from "../../../src/system/index.js";
import { parseString } from "../../_helpers/index.js";

/** Audited, with a masked field, a lifecycle stamp and a `versioned` counter —
 *  one of each thing the diff boundary has to suppress — plus a gated list read
 *  for history to inherit.  Mirrors the node/python fixtures field-for-field.
 *
 *  `create(...) audited` rather than a header-wide `audited`: an aggregate that
 *  is BOTH masked and has an audited OPERATION does not compile on .NET today
 *  (the operation handler renders `maskWrap`'s `__maskUser` pattern variable
 *  twice in one scope, once for each snapshot → CS0128).  That is a pre-existing
 *  write-side defect, unrelated to the read path under test here; the fixture
 *  keeps to the lifecycle form so it stays a shape test of THIS feature. */
const MASKED = `system S {
  user { id: string  role: string  permissions: string[] }
  subdomain M {
    permissions { unmask }
    context C {
      aggregate Employee with versioned, auditable {
        name: string
        salary: decimal mask unless currentUser.permissions.contains(permissions.unmask)
        create(name: string, salary: decimal) audited {
          name := name
          salary := salary
        }
        operation rename(name: string) { name := name }
      }
      repository Employees for Employee {
        find all(): Employee[] requires currentUser.role == "hr"
      }
    }
  }
  api A from M
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  deployable api { platform: dotnet  contexts: [C]  dataSources: [st]  serves: A  port: 8080  auth: required }
}`;

async function emit(src: string): Promise<Map<string, string>> {
  const { model } = await parseString(src);
  return generateSystems(model).files;
}

const fileEndingWith = (files: Map<string, string>, suffix: string): string => {
  for (const [p, c] of files) if (p.endsWith(suffix)) return c;
  throw new Error(`no file ending in ${suffix}; have ${[...files.keys()].join(", ")}`);
};

describe("entity history — .NET route surface", () => {
  it("queries audit_records on the indexed (target_type, target_id) pair, oldest first", async () => {
    const reader = fileEndingWith(
      await emit(MASKED),
      "Infrastructure/Persistence/AuditHistoryReader.cs",
    );
    expect(reader).toContain("_db.AuditRecords");
    expect(reader).toContain("r.TargetType == targetType && r.TargetId == targetId");
    expect(reader).toContain(".OrderBy(r => r.At)");
    // The handler passes the aggregate NAME as target_type, matching the write
    // side's `TargetType = "Employee"`.
    const handler = fileEndingWith(await emit(MASKED), "Queries/GetEmployeeHistoryHandler.cs");
    expect(handler).toContain(
      'await _history.ReadAsync("Employee", query.Id.Value.ToString(), cancellationToken)',
    );
  });

  it("emits the shared shape module once, with no aggregate knowledge in it", async () => {
    const mod = fileEndingWith(await emit(MASKED), "Application/Common/AuditHistory.cs");
    expect(mod).toContain("public sealed record AuditEntry(");
    expect(mod).toContain("public static bool Changed(JsonNode? before, JsonNode? after)");
    expect(mod).not.toContain("Employee");
  });

  it("reads the trail through a persistence-neutral PORT, not the aggregate repo", async () => {
    const files = await emit(MASKED);
    // `AuditRecord` lives in Infrastructure; putting the read on the DOMAIN-facing
    // `I<Agg>Repository` would drag it across the layer boundary — the same
    // inversion the Python port refuses.  It also has to work under
    // `persistence: dapper`, where there is no AppDbContext to inject.
    const port = fileEndingWith(files, "Domain/Employees/IEmployeeRepository.cs");
    expect(port).not.toContain("AuditRecord");
    expect(port).not.toContain("HistoryAsync");
    expect(fileEndingWith(files, "Application/Common/IAuditHistoryReader.cs")).toContain(
      "public interface IAuditHistoryReader",
    );
    // …and it is actually bound, or the handler could not resolve.
    expect(fileEndingWith(files, "Program.cs")).toContain(
      "AddScoped<Api.Application.Common.IAuditHistoryReader, Api.Infrastructure.Persistence.AuditHistoryReader>()",
    );
  });
});

describe("entity history — .NET negative authz", () => {
  it("is fail-closed on an unauthenticated caller", async () => {
    const handler = fileEndingWith(await emit(MASKED), "Queries/GetEmployeeHistoryHandler.cs");
    // The ambient NULLABLE accessor: no principal → the `is { }` pattern fails →
    // every masked entry drops.  Same fail-closed shape as `maskWrap` on the
    // entity read (NOT `_currentUser.User`, which is non-nullable).
    expect(handler).toContain("RequestContext.Current?.CurrentUser is { } __maskUser0");
  });

  it("declares the 403 and 404 the history action can answer with", async () => {
    const files = await emit(MASKED);
    const ctrl = fileEndingWith(files, "Api/EmployeesController.cs");
    const action = ctrl.slice(ctrl.indexOf('[HttpGet("{id}/history")]'));
    expect(action).toContain("[ProducesResponseType(typeof(ProblemDetails), 403)]");
    expect(action).toContain("[ProducesResponseType(typeof(ProblemDetails), 404)]");
  });
});

describe("entity history — aggregates that serve none", () => {
  it("emits no shared history module or reader when nothing is audited", async () => {
    const files = await emit(MASKED.replace("audited {\n", "{\n"));
    expect([...files.keys()].some((p) => p.endsWith("Application/Common/AuditHistory.cs"))).toBe(
      false,
    );
    expect([...files.keys()].some((p) => p.endsWith("AuditHistoryReader.cs"))).toBe(false);
  });
});
