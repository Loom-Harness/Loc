// D13 (claims eval): two generator-side naming/index corrections, and the
// migration each one costs a project that was generated BEFORE the fix.
//
//   a. `workflow replicatePolicies` → saga table `replicate_policieses`: the
//      plural rule doubled an already-plural `-ies` stem.  Now
//      `replicate_policies`.
//   b. `unique (p)` on an FK column emitted `r2s_p_uq` AND the derived FK
//      index `r2s_p_idx` over the same single column.  The plain one is gone.
//
// Renaming a generated relation changes an existing user's schema, so the
// load-bearing half of this suite is the evolution: over a baseline snapshot
// that still records the OLD names, the delta must be exactly
// `ALTER TABLE … RENAME` + `DROP INDEX` — never a drop + create (data loss),
// and never a destructive-gate refusal.

import { describe, expect, it } from "vitest";
import type { MigrationStep, SchemaSnapshot } from "../../src/ir/types/migrations-ir.js";
import { buildMigrations } from "../../src/system/migrations-builder.js";
import { memorySnapshotStore } from "../../src/system/snapshot.js";
import {
  legacyWorkflowStateTableName,
  plural,
  snake,
  workflowStateTableName,
} from "../../src/util/naming.js";
import { buildLoomModel } from "../_helpers/index.js";

const SOURCE = `
system R { subdomain S { context A {
  aggregate P with crudish { name: string  derived display: string = name  operation go() { emit Went { p: id } } }
  aggregate R2 { p: P id  unique (p) }
  repository Ps for P { }
  repository R2s for R2 { }
  event Went { p: P id }
  workflow replicatePolicies { p: P id  create(e: Went) by e.p { let r = R2.create({ p: e.p }) } }
  workflow fulfillOrder { p: P id  create(e: Went) by e.p { } }
} }
  storage primary { type: postgres }
  resource a { for: A, kind: state, use: primary }
  deployable api { platform: node, contexts: [A], dataSources: [a], port: 3000 }
}
`;

async function sys() {
  const loom = await buildLoomModel(SOURCE);
  return loom.systems[0]!;
}

const indexNames = (snap: SchemaSnapshot, table: string): string[] =>
  snap.tables.find((t) => t.name === table)!.indexes.map((i) => i.name);

/** The snapshot a project generated before the fix carries: the saga table
 *  under its double-plural name, and the plain FK index beside the unique one. */
function preFixSnapshot(fresh: SchemaSnapshot): SchemaSnapshot {
  return {
    ...fresh,
    tables: fresh.tables.map((t) => {
      if (t.name === "replicate_policies") return { ...t, name: "replicate_policieses" };
      if (t.name === "r2s") {
        return {
          ...t,
          indexes: [
            ...t.indexes,
            { name: "r2s_p_idx", table: "r2s", columns: ["p"], unique: false },
          ],
        };
      }
      return t;
    }),
  };
}

describe("D13a — saga table name for an already-plural `-ies` workflow", () => {
  it("keeps an `-ies` stem, pluralises everything else exactly as before", () => {
    expect(workflowStateTableName("replicatePolicies")).toBe("replicate_policies");
    expect(legacyWorkflowStateTableName("replicatePolicies")).toBe("replicate_policieses");
    // Unchanged spellings — the fix must not rename any other saga table.
    for (const wf of ["fulfillOrder", "applyPolicy", "processPayments", "matchBox"]) {
      expect(workflowStateTableName(wf)).toBe(plural(snake(wf)));
      expect(legacyWorkflowStateTableName(wf)).toBe(workflowStateTableName(wf));
    }
  });

  it("a fresh project creates `replicate_policies`", async () => {
    const [m] = buildMigrations(await sys(), memorySnapshotStore());
    const names = m!.next.tables.map((t) => t.name);
    expect(names).toContain("replicate_policies");
    expect(names).not.toContain("replicate_policieses");
    expect(names).toContain("fulfill_orders");
  });
});

describe("D13b — no plain index beside a unique one on the same columns", () => {
  it("a fresh project emits only the unique index on `r2s(p)`", async () => {
    const [m] = buildMigrations(await sys(), memorySnapshotStore());
    expect(indexNames(m!.next, "r2s")).toEqual(["r2s_p_uq"]);
  });
});

describe("D13 — the delta over a pre-fix snapshot is RENAME + DROP INDEX only", () => {
  it("renames the saga table and drops the redundant index, nothing else", async () => {
    const s = await sys();
    const [fresh] = buildMigrations(s, memorySnapshotStore());
    const baseline = preFixSnapshot(fresh!.next);
    // Default policy (no --allow-destructive): a destructive step would throw.
    const [m] = buildMigrations(s, memorySnapshotStore({ S: baseline }));
    const steps: MigrationStep[] = m!.steps;
    expect(steps).toEqual([
      { op: "dropIndex", name: "r2s_p_idx", table: "r2s", schema: "a" },
      { op: "renameTable", from: "replicate_policieses", to: "replicate_policies", schema: "a" },
    ]);
    expect(steps.some((x) => x.op === "dropTable" || x.op === "createTable")).toBe(false);
    // The next snapshot records the corrected names, so the following
    // regeneration is a no-op.
    const [again] = buildMigrations(s, memorySnapshotStore({ S: m!.next }));
    expect(again!.steps).toEqual([]);
  });
});
