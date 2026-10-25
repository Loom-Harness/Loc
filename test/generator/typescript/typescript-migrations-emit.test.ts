import { describe, expect, it } from "vitest";

import { emitTypescriptMigrations } from "../../../src/generator/typescript/emit/migrations.js";
import type { MigrationsIR, SchemaSnapshot } from "../../../src/ir/types/migrations-ir.js";

// ---------------------------------------------------------------------------
// TS/Hono migrations emitter — emits Drizzle-format `<tag>.sql` files
// with `--> statement-breakpoint` separators + a `meta/_journal.json`
// index that both `drizzle-kit migrate` and Drizzle's runtime migrator
// (`drizzle-orm/.../migrator`) consume.
// ---------------------------------------------------------------------------

function snap(): SchemaSnapshot {
  return { schemaVersion: 1, tables: [] };
}

function ir(
  steps: MigrationsIR["steps"],
  opts: { version?: string; name?: string; module?: string } = {},
): MigrationsIR {
  return {
    module: opts.module ?? "Sales",
    storageName: "",
    baseline: snap(),
    next: snap(),
    steps,
    version: opts.version ?? "20260101000001",
    name: opts.name ?? "AddSomething",
  };
}

describe("typescript migrations emitter", () => {
  it("emits one .sql file per non-empty MigrationsIR with statement-breakpoint separators", () => {
    const out = new Map<string, string>();
    emitTypescriptMigrations(
      [
        ir(
          [
            {
              op: "createTable",
              table: {
                name: "orders",
                ownerModule: "Sales",
                columns: [
                  { name: "id", type: { kind: "uuid" }, nullable: false },
                  { name: "total", type: { kind: "int" }, nullable: false },
                ],
                primaryKey: ["id"],
                foreignKeys: [],
                indexes: [],
              },
            },
            { op: "dropTable", name: "legacy" },
          ],
          { version: "20260101000000", name: "Initial" },
        ),
      ],
      out,
    );
    // The tag is module-qualified ("sales") so a backend hosting several
    // modules doesn't collide every module's "Initial" onto one file.
    expect(out.has("db/migrations/20260101000000_sales_initial.sql")).toBe(true);
    const sql = out.get("db/migrations/20260101000000_sales_initial.sql")!;
    expect(sql).toMatch(/CREATE TABLE "orders" \(/);
    expect(sql).toMatch(/PRIMARY KEY \("id"\)/);
    // Drizzle splits on the sentinel — both statements need to be
    // visible as separate chunks.
    expect(sql).toContain("--> statement-breakpoint");
    expect(sql.indexOf("DROP TABLE")).toBeGreaterThan(sql.indexOf("--> statement-breakpoint"));
  });

  it("emits a Drizzle-format meta/_journal.json listing every chain generation", () => {
    const out = new Map<string, string>();
    emitTypescriptMigrations(
      [
        ir([{ op: "dropTable", name: "w" }], { version: "20260101000000", name: "Initial" }),
        ir([{ op: "dropTable", name: "x" }], { version: "20260101000005", name: "DropX" }),
      ],
      out,
    );
    expect(out.has("db/migrations/meta/_journal.json")).toBe(true);
    const journal = JSON.parse(out.get("db/migrations/meta/_journal.json")!);
    expect(journal).toMatchObject({
      version: "7",
      dialect: "postgresql",
    });
    expect(journal.entries).toHaveLength(2);
    expect(journal.entries[0]).toMatchObject({
      idx: 0,
      tag: "20260101000000_sales_initial",
      breakpoints: true,
    });
    expect(journal.entries[1]).toMatchObject({
      idx: 1,
      tag: "20260101000005_sales_drop_x",
      breakpoints: true,
    });
    // `when` is the entry's position in chain order.
    expect(typeof journal.entries[0].when).toBe("number");
    expect(journal.entries[0].when).toBeLessThan(journal.entries[1].when);
  });

  it("skips empty-step migrations entirely (no .sql, no journal)", () => {
    const out = new Map<string, string>();
    emitTypescriptMigrations(
      [
        {
          module: "Sales",
          storageName: "",
          baseline: snap(),
          next: snap(),
          steps: [],
          version: "20260101000001",
          name: "NoOp",
        },
      ],
      out,
    );
    expect(out.size).toBe(0);
  });

  it("keeps two modules' generations distinct (module-qualified tags)", () => {
    const out = new Map<string, string>();
    // Two modules in one deployable, each with its own "Initial".  Qualifying
    // the tag with the module keeps them distinct.
    emitTypescriptMigrations(
      [
        ir([{ op: "dropTable", name: "a" }], {
          module: "ModuleA",
          version: "20260101000000",
          name: "Initial",
        }),
        ir([{ op: "dropTable", name: "b" }], {
          module: "ModuleB",
          version: "20260102000000",
          name: "Initial",
        }),
        ir([{ op: "dropTable", name: "c" }], { module: "ModuleA", version: "20260103000000" }),
      ],
      out,
    );
    const journal = JSON.parse(out.get("db/migrations/meta/_journal.json")!);
    expect(journal.entries.map((e: { version: string; tag: string }) => e.tag)).toEqual([
      "20260101000000_module_a_initial",
      "20260102000000_module_b_initial",
      "20260103000000_module_a_add_something",
    ]);
    const whens = journal.entries.map((e: { when: number }) => e.when);
    for (let i = 1; i < whens.length; i++) {
      expect(whens[i]).toBeGreaterThan(whens[i - 1]);
    }
  });

  // -------------------------------------------------------------------------
  // The journal's ORDERING KEY.
  //
  // Drizzle's runtime migrator is a WATERMARK: it applies a journal entry only
  // when `lastApplied.created_at < entry.when`, strictly.  So the key must be
  //
  //   (1) strictly increasing down the journal;
  //   (2) unchanged for an entry already applied;
  //   (3) greater, for a newly recorded entry, than for every entry already
  //       applied.
  //
  // The chain only grows at its head, with a version above every existing
  // one, so the cases below are "record one more generation".
  // -------------------------------------------------------------------------
  describe("journal ordering key", () => {
    type Gen = { module: string; version: string; name: string };
    /** Module A initial, module B initial — the state after the FIRST deploy. */
    const deployed: Gen[] = [
      { module: "ModuleA", version: "20260101000000", name: "Initial" },
      { module: "ModuleB", version: "20260102000000", name: "Initial" },
    ];
    /** …and after the first evolution: a delta recorded for module A. */
    const evolved: Gen[] = [
      ...deployed,
      { module: "ModuleA", version: "20260103000000", name: "AddNotes" },
    ];

    function journalFor(
      gens: Gen[],
      extra: ReadonlyArray<{ version: string; tag: string }> = [],
    ): { tag: string; when: number }[] {
      const out = new Map<string, string>();
      emitTypescriptMigrations(
        gens.map((g, i) => ir([{ op: "dropTable", name: `t${i}` }], g)),
        out,
        extra,
      );
      return JSON.parse(out.get("db/migrations/meta/_journal.json")!).entries;
    }

    const PROVENANCE = [{ version: "29991231000000", tag: "29991231000000_provenance" }];

    it("(1) is strictly increasing", () => {
      const whens = journalFor(evolved, PROVENANCE).map((e) => e.when);
      for (let i = 1; i < whens.length; i++) {
        expect(whens[i]).toBeGreaterThan(whens[i - 1]);
      }
    });

    it("(2) does not renumber an already-applied entry when a generation is recorded", () => {
      const before = new Map(journalFor(deployed, PROVENANCE).map((e) => [e.tag, e.when]));
      const after = new Map(journalFor(evolved, PROVENANCE).map((e) => [e.tag, e.when]));
      for (const tag of ["20260101000000_module_a_initial", "20260102000000_module_b_initial"]) {
        expect(after.get(tag)).toBe(before.get(tag));
      }
    });

    it("(3) gives a newly recorded generation a `when` above every already-applied entry", () => {
      // The watermark the first deploy leaves behind is the HIGHEST `when` in
      // the journal it applied — which includes the always-last provenance
      // entry.  A new delta must clear it, or the migrator silently skips it.
      const watermark = Math.max(...journalFor(deployed, PROVENANCE).map((e) => e.when));
      const inserted = journalFor(evolved, PROVENANCE).find(
        (e) => e.tag === "20260103000000_module_a_add_notes",
      );
      expect(inserted).toBeDefined();
      expect(inserted!.when).toBeGreaterThan(watermark);
    });

    it("keeps the provenance entry LAST without pinning it above future migrations", () => {
      const after = journalFor(evolved, PROVENANCE);
      const provenance = after[after.length - 1];
      expect(provenance.tag).toBe("29991231000000_provenance");
      for (const e of after.slice(0, -1)) {
        expect(provenance.when).toBeGreaterThan(e.when);
      }
      // ...but NOT so far ahead that the next generation cannot clear it.
      const next = journalFor(
        [...evolved, { module: "ModuleA", version: "20260103000001", name: "AddMore" }],
        PROVENANCE,
      );
      const added = next.find((e) => e.tag === "20260103000001_module_a_add_more");
      expect(added).toBeDefined();
      expect(added!.when).toBeGreaterThan(provenance.when);
    });
  });
});
