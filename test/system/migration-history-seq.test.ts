import { describe, expect, it } from "vitest";
import type { MigrationsIR, SchemaSnapshot } from "../../src/ir/types/migrations-ir.js";
import { buildMigrations } from "../../src/system/migrations-builder.js";
import { memorySnapshotStore } from "../../src/system/snapshot.js";
import { buildLoomModel } from "../_helpers/index.js";

// ---------------------------------------------------------------------------
// F-012 — the per-entry CREATION ORDINAL (`MigrationHistoryEntry.seq`).
//
// Drizzle's runtime migrator is a WATERMARK: it applies a journal entry only
// when `lastApplied.created_at < entry.when`, strictly.  The journal derives
// `when` from this ordinal, so the ordinal carries the two invariants the
// journal cannot establish for itself:
//
//   STABILITY  an entry already applied keeps its ordinal for life.  The key
//              this replaced was the entry's ARRAY POSITION, so inserting a
//              migration renumbered every later entry and the journal stopped
//              agreeing with what the database recorded as applied.
//   ASCENT     a newly appended entry is allocated ABOVE every ordinal already
//              in use.  `version` cannot supply this: versions are allocated in
//              per-module BLOCKS, so a delta in block 0 (`20260101500001`)
//              sorts BELOW the initial of block 1 (`20260102000000`) and the
//              watermark hides it forever.
//
// The runtime proof is the `journal-ordering` leg of migration-evolution-e2e,
// which boots a two-module `provenanced` stack twice against a real Postgres.
// That gate is opt-in (push:main / label / merge_group), so these fast checks
// exist to keep the ALLOCATION itself covered by `npm test` — the e2e proves
// the behaviour, this proves the invariant that produces it.
//
// Sibling of migration-version-blocks.test.ts: `versionBlock` is the same
// shape of fix (a recorded fact replacing a positional one) for the same
// reason, and this file deliberately mirrors its cases.
// ---------------------------------------------------------------------------

const MODULES = `
  subdomain Catalog {
    context Catalog {
      aggregate Project with crudish { title: string__CATALOG_EXTRA__ }
      repository Projects for Project { }
    }
  }
  subdomain Builds {
    context Builds {
      aggregate Build with crudish { sha: string }
      repository BuildsRepo for Build { }
    }
  }
  subdomain People {
    context People {
      aggregate Engineer with crudish { nick: string }
      repository Engineers for Engineer { }
    }
  }
`;

const SOURCE = (catalogExtra = ""): string => `
system Multi {
${MODULES.replace("__CATALOG_EXTRA__", catalogExtra)}
  api CatalogApi from Catalog
  api BuildsApi from Builds
  api PeopleApi from People
  storage primary { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: primary }
  resource buildsState { for: Builds, kind: state, use: primary }
  resource peopleState { for: People, kind: state, use: primary }
  deployable svc {
    platform: node
    contexts: [Catalog, Builds, People]
    dataSources: [catalogState, buildsState, peopleState]
    serves: CatalogApi, BuildsApi, PeopleApi
    port: 4000
  }
}
`;

async function sys(catalogExtra = "") {
  const loom = await buildLoomModel(SOURCE(catalogExtra));
  return loom.systems[0]!;
}

function storeOf(migrations: MigrationsIR[]) {
  return memorySnapshotStore(
    Object.fromEntries(migrations.map((m) => [m.module, m.next])) as Record<string, SchemaSnapshot>,
  );
}

/** Every (module, version, name) → its recorded ordinal. */
function ordinals(migrations: MigrationsIR[]): Map<string, number | undefined> {
  const out = new Map<string, number | undefined>();
  for (const m of migrations) {
    for (const e of m.next.migrationHistory ?? []) {
      out.set(`${m.module}/${e.version}/${e.name}`, e.seq);
    }
  }
  return out;
}

describe("migration-history creation ordinals (F-012)", () => {
  it("stamps an ordinal on EVERY history entry, distinct across modules", async () => {
    const first = buildMigrations(await sys(), memorySnapshotStore());
    const seqs = [...ordinals(first).values()];
    expect(seqs).toHaveLength(3);
    // The journal falls back to a positional key — the defective one — the
    // moment ANY entry lacks an ordinal, so "every entry has one" is the
    // invariant that keeps the fixed path live, not a nicety.
    expect(seqs.every((s) => typeof s === "number")).toBe(true);
    expect(new Set(seqs).size).toBe(3);
  });

  it("STABILITY — an entry keeps its ordinal across a no-op regeneration", async () => {
    const s = await sys();
    const first = buildMigrations(s, memorySnapshotStore());
    const second = buildMigrations(s, storeOf(first));
    expect(ordinals(second)).toEqual(ordinals(first));
  });

  it("STABILITY — inserting a migration does not renumber the entries already applied", async () => {
    const first = buildMigrations(await sys(), memorySnapshotStore());
    // Evolve ONE module: Catalog gains a field, so its delta is appended while
    // Builds and People stand still.  Under the positional key every entry
    // after the insertion point shifted by one.
    const second = buildMigrations(await sys("\n        blurb: string?"), storeOf(first));
    const before = ordinals(first);
    const after = ordinals(second);
    for (const [key, seq] of before) {
      expect(after.get(key), `ordinal of already-applied ${key} must not move`).toBe(seq);
    }
    expect(after.size).toBe(before.size + 1);
  });

  it("ASCENT — the inserted entry is allocated above every ordinal already in use", async () => {
    const first = buildMigrations(await sys(), memorySnapshotStore());
    const second = buildMigrations(await sys("\n        blurb: string?"), storeOf(first));
    const before = ordinals(first);
    const highestApplied = Math.max(...[...before.values()].map((s) => s as number));
    const inserted = [...ordinals(second).entries()].filter(([k]) => !before.has(k));
    expect(inserted).toHaveLength(1);
    expect(inserted[0][1] as number).toBeGreaterThan(highestApplied);
  });

  it("backfills a history written before the field existed, deterministically", async () => {
    const s = await sys();
    const first = buildMigrations(s, memorySnapshotStore());
    // Strip every `seq` — exactly what a project generated before this change
    // carries.  The backfill orders by (version, module), the order the old
    // journal already applied them in, so an existing project's history keeps
    // its shape instead of being reshuffled.
    const legacy = Object.fromEntries(
      first.map((m) => [
        m.module,
        {
          ...m.next,
          migrationHistory: (m.next.migrationHistory ?? []).map(({ seq: _drop, ...e }) => e),
        } as SchemaSnapshot,
      ]),
    );
    const next = buildMigrations(s, memorySnapshotStore(legacy));
    const seqs = next.map((m) => m.next.migrationHistory![0].seq!);
    expect(seqs.every((x) => typeof x === "number")).toBe(true);
    expect(new Set(seqs).size).toBe(3);
    // Version order is preserved: module N's block sorts below module N+1's.
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it("backfills ABOVE recorded ordinals when only some snapshots carry them", async () => {
    const s = await sys();
    const first = buildMigrations(s, memorySnapshotStore());
    // A half-migrated project: one module has been re-stamped, two have not.
    // The RETAINED module is deliberately the one holding the LOWEST ordinal —
    // restarting the backfill at 1 then lands on top of it, which is the whole
    // failure mode. Retaining the highest instead makes the test vacuous: the
    // backfill reproduces the original numbering and nothing collides.
    const retained = "Catalog";
    const mixed = Object.fromEntries(
      first.map((m) => [
        m.module,
        m.module === retained
          ? m.next
          : ({
              ...m.next,
              migrationHistory: (m.next.migrationHistory ?? []).map(({ seq: _drop, ...e }) => e),
            } as SchemaSnapshot),
      ]),
    );
    const kept = first.find((m) => m.module === retained)!.next.migrationHistory![0];
    expect(kept.seq, "the retained module must hold the lowest ordinal").toBe(1);
    const next = buildMigrations(s, memorySnapshotStore(mixed));
    const seqs = [...ordinals(next).values()].map((s2) => s2 as number);
    // A duplicate ordinal is a duplicate `when`, and a duplicate `when` is the
    // one journal failure that is silent: drizzle skips the second entry.
    expect(new Set(seqs).size, `ordinals must stay distinct, got ${seqs}`).toBe(3);
    expect(ordinals(next).get(`${retained}/${kept.version}/${kept.name}`)).toBe(kept.seq);
  });
});
