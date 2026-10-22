// Entity history — the node/Hono read path (docs/audit.md).
//
// An audit row's `before`/`after` snapshots are written server-side inside the
// command's transaction, where there is no caller to mask against, so they hold
// raw values for every field, and every guard the entity read has must be
// re-established on the history read explicitly.  The guards' RUNTIME claims —
// the masked field's entry dropped (not redacted) for a caller the mask refuses
// and kept for one it admits, the inherited gate's 403 ahead of the row lookup,
// stamps / `version` / `id` never in a diff, no route on an unaudited aggregate
// — are asserted on every backend's booted wire by the corpus case
// `test/fixtures/corpus/audit-history-guarded.ddd` and its golden.  What stays
// here is what that wire cannot see: emission shape, the anonymous caller
// (the behavioural harness has none), and the per-target spellings below.

import { describe, expect, it } from "vitest";
import { generateSystems } from "../../src/system/index.js";
import { parseString } from "../_helpers/parse.js";

/** An audited aggregate with a masked field, a stamp, and a `versioned`
 *  counter — one of each thing the diff boundary must suppress. */
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
        find all(): Employee[] requires currentUser.role == "hr"
      }
    }
  }
  api A from M
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  deployable api { platform: node  contexts: [C]  dataSources: [st]  serves: A  port: 8080  auth: required }
}`;

async function emitFiles(src: string): Promise<Map<string, string>> {
  const { model } = await parseString(src);
  return generateSystems(model).files;
}

const routesOf = (files: Map<string, string>, agg: string): string => {
  for (const [p, c] of files) if (p.endsWith(`http/${agg}.routes.ts`)) return c;
  throw new Error(`no routes file for ${agg}; have ${[...files.keys()].join(", ")}`);
};

describe("entity history — node route surface", () => {
  it("filters the trail on the target TYPE too, oldest first", async () => {
    const routes = routesOf(await emitFiles(MASKED), "employee");
    // The type half of the pair the write side indexes.  With uuid ids a read
    // keyed on `target_id` alone returns the same rows, so no wire golden can
    // tell the two apart — this is its only witness.  Oldest first: a timeline
    // reads forwards, and a dropped ORDER BY usually still returns insertion
    // order, so the wire would not catch that either.
    expect(routes).toContain('eq(schema.auditRecords.targetType, "Employee")');
    expect(routes).toContain("orderBy(schema.auditRecords.at)");
  });

  it("emits the shared shape module once, with no aggregate knowledge in it", async () => {
    const files = await emitFiles(MASKED);
    const mod = [...files].find(([p]) => p.endsWith("audit/history.ts"))?.[1];
    expect(mod).toBeDefined();
    expect(mod).toContain("export interface AuditEntry");
    expect(mod).toContain("export const AuditEntryResponse");
    expect(mod).toContain("export function auditValueChanged");
    // Shape-only: one copy serves every audited aggregate.
    expect(mod).not.toContain("Employee");
  });
});

describe("entity history — negative authz", () => {
  it("is fail-closed on an unauthenticated caller", async () => {
    const routes = routesOf(await emitFiles(MASKED), "employee");
    // `?? null` → the guard's `currentUser !== null` short-circuits → every
    // masked entry drops.  Same fail-closed shape as `toWireMasked`.
    expect(routes).toContain('.get("currentUser") ?? null');
    expect(routes).toContain("currentUser !== null &&");
  });

  it("declares the inherited gate's 403 in the route's OpenAPI responses", async () => {
    const routes = routesOf(await emitFiles(MASKED), "employee");
    const handler = routes.slice(routes.indexOf('path: "/{id}/history"'));
    expect(handler).toContain('403: { description: "Forbidden"');
  });

  // F2-W-05 residue.  The row's fix reached the aggregate `toWire` path and the
  // query-time projection routes; the audit trail's own `at` — a `datetime` on
  // the wire like any other — was still a bare `toISOString()`, which ALWAYS
  // pads the fraction to exactly three digits.  That put node alone against the
  // other four on this endpoint: .NET regex-trims (`Regex.Replace(…, @"\.?0+Z$",
  // "Z")`), java renders `Instant.toString()` and python `iso()`, all three of
  // which omit a zero fraction.
  it("renders the trail's `at` in the canonical RS-4 form, not `.000Z`", async () => {
    const routes = routesOf(await emitFiles(MASKED), "employee");
    const mapper = routes.slice(routes.indexOf("function employeeAuditEntry"));
    const atLine = mapper.split("\n").find((l) => l.trim().startsWith("at:"));
    expect(atLine).toBeDefined();
    expect(atLine).toContain('row.at.toISOString().replace(/\\.000Z$/, "Z")');
    // The defect was a WRONG STRING, not a compile break, so evaluate the
    // rendered expression: a whole-second instant must lose the fraction, and a
    // sub-second one must keep every digit it has.
    const evalAt = (iso: string): unknown =>
      new Function(
        "row",
        `return ${atLine
          ?.trim()
          .replace(/^at:\s*/, "")
          .replace(/,$/, "")};`,
      )({
        at: new Date(iso),
      });
    expect(evalAt("2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00Z");
    // RS-38: a present fraction keeps EXACTLY three digits.  This line pinned
    // `.12Z` — the minimal trim that was itself the F2-W-06 divergence (java
    // `.120Z`, python `.120000Z`), so the test agreed with the bug.
    expect(evalAt("2026-01-01T00:00:00.120Z")).toBe("2026-01-01T00:00:00.120Z");
    expect(evalAt("2026-01-01T00:00:00.123Z")).toBe("2026-01-01T00:00:00.123Z");
  });
});

describe("entity history — aggregates that serve none", () => {
  it("emits no shared history module when nothing is audited", async () => {
    const files = await emitFiles(
      MASKED.replace("aggregate Employee audited", "aggregate Employee"),
    );
    expect([...files.keys()].some((p) => p.endsWith("audit/history.ts"))).toBe(false);
  });
});
