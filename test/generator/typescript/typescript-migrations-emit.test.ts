import { describe, expect, it } from "vitest";

import { emitTypescriptMigrations } from "../../../src/generator/typescript/emit/migrations.js";
import type {
  MigrationHistoryEntry,
  MigrationsIR,
  SchemaSnapshot,
} from "../../../src/ir/types/migrations-ir.js";

// ---------------------------------------------------------------------------
// TS/Hono migrations emitter — emits Drizzle-format `<tag>.sql` files
// with `--> statement-breakpoint` separators + a `meta/_journal.json`
// index that both `drizzle-kit migrate` and Drizzle's runtime migrator
// (`drizzle-orm/.../migrator`) consume.
// ---------------------------------------------------------------------------

function snap(history: MigrationHistoryEntry[] = [], lastVersion?: string): SchemaSnapshot {
  return {
    schemaVersion: 1,
    lastVersion,
    migrationHistory: history.length > 0 ? history : undefined,
    tables: [],
  };
}

function ir(
  steps: MigrationsIR["steps"],
  opts: { version?: string; name?: string; history?: MigrationHistoryEntry[] } = {},
): MigrationsIR {
  const version = opts.version ?? "20260101000001";
  const name = opts.name ?? "AddSomething";
  return {
    module: "Sales",
    storageName: "",
    baseline: snap(),
    next: snap([...(opts.history ?? []), { version, name }], version),
    steps,
    version,
    name,
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

  it("emits a Drizzle-format meta/_journal.json from the snapshot's migration history", () => {
    const out = new Map<string, string>();
    emitTypescriptMigrations(
      [
        ir([{ op: "dropTable", name: "x" }], {
          version: "20260101000005",
          name: "DropX",
          history: [{ version: "20260101000000", name: "Initial" }],
        }),
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
    // `when` is derived from the version slug (epoch-millis).
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

  it("keeps multi-module history entries distinct (module-qualified, no cross-module version dedup)", () => {
    const out = new Map<string, string>();
    // Two modules in one deployable, each with its own "Initial" at the
    // shared BASE version.  De-duping by version alone (the old bug)
    // would collapse both Initials into one tag and lose a module's
    // tables.  Qualifying the tag with the module keeps them distinct.
    const initial: MigrationHistoryEntry = { version: "20260101000000", name: "Initial" };
    emitTypescriptMigrations(
      [
        {
          ...ir([{ op: "dropTable", name: "a" }], { version: "20260101000001" }),
          module: "ModuleA",
          next: snap([initial, { version: "20260101000001", name: "AddSomething" }]),
        },
        {
          ...ir([{ op: "dropTable", name: "b" }], { version: "20260101000002" }),
          module: "ModuleB",
          next: snap([initial, { version: "20260101000002", name: "AddSomething" }]),
        },
      ],
      out,
    );
    const journal = JSON.parse(out.get("db/migrations/meta/_journal.json")!);
    // Sorted by (version, module): both Initials survive, then each
    // module's delta — four entries, none colliding.
    expect(journal.entries.map((e: { version: string; tag: string }) => e.tag)).toEqual([
      "20260101000000_module_a_initial",
      "20260101000000_module_b_initial",
      "20260101000001_module_a_add_something",
      "20260101000002_module_b_add_something",
    ]);
    // `when` must be STRICTLY increasing across entries — the two Initials
    // share a version (same epoch millis).  Drizzle's runtime migrator applies
    // a migration only when `lastApplied.created_at < when`, so a tie silently
    // skips the second Initial (ModuleB's tables never get created).  The
    // per-entry index breaks the tie.
    const whens = journal.entries.map((e: { when: number }) => e.when);
    expect(whens[1]).toBeGreaterThan(whens[0]);
    for (let i = 1; i < whens.length; i++) {
      expect(whens[i]).toBeGreaterThan(whens[i - 1]);
    }
  });

  // -------------------------------------------------------------------------
  // F-012 — the journal's ORDERING KEY.
  //
  // Drizzle's runtime migrator is a WATERMARK: it applies a journal entry only
  // when `lastApplied.created_at < entry.when`, strictly.  Three requirements
  // follow, and the old positional key (`epochMillis(version) + arrayIndex`)
  // met none of them on a real multi-module evolution:
  //
  //   (1) strictly increasing down the journal;
  //   (2) NEVER changing for an entry already applied;
  //   (3) strictly greater, for a newly appended entry, than for every entry
  //       already applied.
  //
  // The gate below is built from the real shape `buildMigrations` produces:
  // per-module version BLOCKS (`MODULE_VERSION_STRIDE`), which is what makes
  // (1) and (3) fail for any key derived from `version` — module A's delta
  // (`20260101500001`) sorts BELOW module B's initial (`20260102000000`).
  // -------------------------------------------------------------------------
  describe("journal ordering key (F-012)", () => {
    /** Module A initial, module B initial — the state after the FIRST deploy.
     *  `seq` is the creation ordinal `buildMigrations` now records. */
    const deployed: MigrationHistoryEntry[][] = [
      [{ version: "20260101000000", name: "Initial", seq: 1 }],
      [{ version: "20260102000000", name: "Initial", seq: 2 }],
    ];
    /** …and after the FIRST EVOLUTION: a delta inserted into module A, which
     *  lands in A's own version block and therefore BELOW B's initial. */
    const evolved: MigrationHistoryEntry[][] = [
      [
        { version: "20260101000000", name: "Initial", seq: 1 },
        { version: "20260101500001", name: "AddNotes", seq: 3 },
      ],
      [{ version: "20260102000000", name: "Initial", seq: 2 }],
    ];

    function journalFor(
      histories: MigrationHistoryEntry[][],
      extra: ReadonlyArray<{ version: string; tag: string }> = [],
    ): { tag: string; when: number }[] {
      const out = new Map<string, string>();
      emitTypescriptMigrations(
        histories.map((history, i) => ({
          module: i === 0 ? "ModuleA" : "ModuleB",
          storageName: "",
          baseline: snap(),
          next: snap(history),
          steps: [{ op: "dropTable", name: `t${i}` }],
          version: history[history.length - 1].version,
          name: history[history.length - 1].name,
        })),
        out,
        extra,
      );
      return JSON.parse(out.get("db/migrations/meta/_journal.json")!).entries;
    }

    const PROVENANCE = [{ version: "29991231000000", tag: "29991231000000_provenance" }];

    it("(1) is strictly increasing even when a module's delta sorts below a later module's initial", () => {
      const whens = journalFor(evolved, PROVENANCE).map((e) => e.when);
      for (let i = 1; i < whens.length; i++) {
        expect(whens[i]).toBeGreaterThan(whens[i - 1]);
      }
    });

    it("(2) does not renumber an already-applied entry when a migration is inserted", () => {
      const before = new Map(journalFor(deployed, PROVENANCE).map((e) => [e.tag, e.when]));
      const after = new Map(journalFor(evolved, PROVENANCE).map((e) => [e.tag, e.when]));
      // Both module initials were applied by the first deploy; the database
      // recorded those exact `when` values.  Inserting module A's delta must
      // leave them untouched — otherwise the journal stops agreeing with the
      // database about what has run.
      for (const tag of ["20260101000000_module_a_initial", "20260102000000_module_b_initial"]) {
        expect(after.get(tag)).toBe(before.get(tag));
      }
    });

    it("(3) gives a newly inserted migration a `when` above every already-applied entry", () => {
      // The watermark the first deploy leaves behind is the HIGHEST `when` in
      // the journal it applied — which includes the always-last provenance
      // entry.  A new delta must clear it, or the migrator silently skips it
      // and the column never appears (F-012 symptom 1).
      const watermark = Math.max(...journalFor(deployed, PROVENANCE).map((e) => e.when));
      const after = journalFor(evolved, PROVENANCE);
      const inserted = after.find((e) => e.tag === "20260101500001_module_a_add_notes");
      expect(inserted).toBeDefined();
      expect(inserted!.when).toBeGreaterThan(watermark);
    });

    it("keeps the provenance entry LAST without pinning it above future migrations", () => {
      const after = journalFor(evolved, PROVENANCE);
      const provenance = after[after.length - 1];
      expect(provenance.tag).toBe("29991231000000_provenance");
      // Last in its own generation...
      for (const e of after.slice(0, -1)) {
        expect(provenance.when).toBeGreaterThan(e.when);
      }
      // ...but NOT so far ahead that the next generation cannot clear it.  A
      // year-2999 sentinel (~3.25e13) made every later migration unreachable;
      // the gap here is a single slot.
      const nextGeneration: MigrationHistoryEntry[][] = [
        [...evolved[0], { version: "20260101500002", name: "AddMore", seq: 4 }],
        evolved[1],
      ];
      const next = journalFor(nextGeneration, PROVENANCE);
      const added = next.find((e) => e.tag === "20260101500002_module_a_add_more");
      expect(added).toBeDefined();
      expect(added!.when).toBeGreaterThan(provenance.when);
    });
  });
});
