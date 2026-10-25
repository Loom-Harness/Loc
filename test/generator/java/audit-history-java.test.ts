// Entity history on Java/Spring Boot — the read side of the `audited` trail
// (docs/audit.md).  The RUNTIME contract is proven by the behavioral leg
// (`node run-java.mjs audit-history audit-history-guarded` diffs the booted
// app's responses against the node-minted wire goldens) and
// `gradle testClasses bootJar` proves the emitted project compiles.  The
// guards' runtime claims — mask drop, the inherited gate's 403 ahead of the row
// lookup, stamps out of the diff, no route when unaudited — are on that wire
// (`audit-history-guarded`); this suite keeps what it cannot see.

import { describe, expect, it } from "vitest";
import { generateSystems } from "../../../src/system/index.js";
import { parseString } from "../../_helpers/index.js";

/** Audited, with a masked field, a lifecycle stamp and a `versioned` counter —
 *  one of each thing the diff boundary has to suppress — plus a gated list read
 *  for history to inherit. */
const MASKED = `system S {
  user { id: string  role: string  permissions: string[] }
  subdomain M {
    permissions { unmask }
    context C {
      aggregate Employee audited with versioned, auditable {
        name: string
        salary: decimal mask unless currentUser.permissions.contains(permissions.unmask)
        create(name: string, salary: decimal) {
          name := name
          salary := salary
        }
        operation rename(name: string) { name := name }
      }
      repository Employees for Employee {
        find all(): Employee[]
      }
      policy { read Employee requires currentUser.role == "hr" }
    }
  }
  api A from M
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  deployable api { platform: java  contexts: [C]  dataSources: [st]  serves: A  port: 8080  auth: required }
}`;

async function emit(src: string): Promise<Map<string, string>> {
  const { model } = await parseString(src);
  return generateSystems(model).files;
}

const fileEndingWith = (files: Map<string, string>, suffix: string): string => {
  for (const [p, c] of files) if (p.endsWith(suffix)) return c;
  throw new Error(`no file ending in ${suffix}; have ${[...files.keys()].join(", ")}`);
};

describe("entity history — java route surface", () => {
  it("queries audit_records on the indexed (target_type, target_id) pair, oldest first", async () => {
    const files = await emit(MASKED);
    const port = fileEndingWith(files, "AuditRecordRepository.java");
    // A Spring Data derived finder over exactly the pair the write side
    // indexes; `OrderByAtAsc` is the timeline's natural (forwards) scan order.
    expect(port).toContain(
      "List<AuditRecord> findByTargetTypeAndTargetIdOrderByAtAsc(String targetType, String targetId);",
    );
    const service = fileEndingWith(files, "EmployeeService.java");
    expect(service).toContain(
      'auditRecords.findByTargetTypeAndTargetIdOrderByAtAsc("Employee", id.value().toString())',
    );
  });

  it("emits the shared shape classes once, with no aggregate knowledge in them", async () => {
    const files = await emit(MASKED);
    for (const name of ["AuditEntry.java", "AuditFieldChange.java", "AuditHistory.java"]) {
      const mod = fileEndingWith(files, name);
      expect(mod).not.toContain("Employee");
    }
    expect(fileEndingWith(files, "AuditEntry.java")).toContain("public record AuditEntry(");
    expect(fileEndingWith(files, "AuditHistory.java")).toContain(
      "public static boolean valueChanged(",
    );
  });
});

describe("entity history — java negative authz", () => {
  it("is fail-closed on an unauthenticated caller", async () => {
    const service = fileEndingWith(await emit(MASKED), "EmployeeService.java");
    // The STATIC, non-throwing accessor — an unauthenticated request yields
    // null and every masked entry drops.  Same binding `fromMasked` uses.
    expect(service).toContain("User __maskUser = CurrentUserAccessor.currentOrNull();");
    expect(service).toContain("__maskUser != null &&");
  });
});

describe("entity history — aggregates that serve none", () => {
  it("emits no mapper or shared classes when nothing is audited", async () => {
    const files = await emit(MASKED.replace("aggregate Employee audited", "aggregate Employee"));
    expect([...files.keys()].some((p) => p.endsWith("AuditEntry.java"))).toBe(false);
    expect([...files.keys()].some((p) => p.endsWith("AuditHistory.java"))).toBe(false);
    expect(fileEndingWith(files, "EmployeeService.java")).not.toContain("employeeAuditEntry");
  });
});
