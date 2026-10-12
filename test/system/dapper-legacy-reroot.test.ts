// Re-rooting an output tree the pre-migration Dapper toolchain wrote (M-T2.17).
//
// That toolchain wrote the module snapshot (history `[Initial]`) but no
// migration files, so the migration-baseline guard (b) refused every later
// generate into the tree.  The migration-aware generate recognises exactly that
// signature on a Dapper-owned module and re-emits the Initial from the
// snapshot ahead of its delta; anything else keeps the guard's refusal.  The
// runtime half (baselining the database) is the migration-evolution `dapper`
// leg's legacy case.

import { describe, expect, it } from "vitest";
import type { SchemaSnapshot } from "../../src/ir/types/migrations-ir.js";
import { generateSystems } from "../../src/system/index.js";
import { memoryMigrationArtifactIndex } from "../../src/system/migration-artifacts.js";
import { memorySnapshotStore } from "../../src/system/snapshot.js";
import { parseString } from "../_helpers/parse.js";

const SRC = (persistence: string, extraField: string) => `
system Rr {
  subdomain Catalog {
    context Catalog {
      aggregate Product with crudish {
        name: string
        ${extraField}
      }
      repository Products for Product { }
    }
  }
  api A from Catalog
  storage pg { type: postgres }
  resource s { for: Catalog, kind: state, use: pg }
  deployable d {
    platform: dotnet { persistence: ${persistence} }
    contexts: [Catalog]
    dataSources: [s]
    serves: A
    port: 4000
  }
}`;

/** Generate v1, then v2 against v1's snapshot with `onDisk` as the tree's
 *  migration files. */
async function regen(persistence: string, onDisk: readonly string[]) {
  const stored: Record<string, SchemaSnapshot> = {};
  const gen = async (src: string, files: readonly string[]) => {
    const { model } = await parseString(src);
    const out = generateSystems(model, {
      snapshots: memorySnapshotStore(stored),
      existingMigrations: memoryMigrationArtifactIndex({ Catalog: files }),
    }).files;
    for (const [p, c] of out) {
      const m = /^\.loom\/snapshots\/(.+)\.snapshot\.json$/.exec(p);
      if (m) stored[m[1]!] = JSON.parse(c) as SchemaSnapshot;
    }
    return out;
  };
  await gen(SRC(persistence, ""), []);
  return gen(SRC(persistence, "note: string?"), onDisk);
}

describe("re-rooting a pre-migration Dapper output tree", () => {
  it("re-emits the Initial from the snapshot, then this run's delta", async () => {
    const out = await regen("dapper", []);
    const migrations = [...out.keys()].filter((p) => p.startsWith("d/Migrations/")).sort();
    expect(migrations).toEqual([
      "d/Migrations/20260101000000_Catalog_Initial.cs",
      expect.stringMatching(/^d\/Migrations\/20260101500001_Catalog_\w+\.cs$/),
    ]);
    const initial = out.get(migrations[0]!)!.replace(/""/g, '"');
    // the v1 schema — the shape the old bootstrap provisioned
    expect(initial).toContain('CREATE TABLE "catalog"."products"');
    expect(initial).not.toContain('"note"');
    expect(out.get(migrations[1]!)!.replace(/""/g, '"')).toContain('ADD COLUMN "note"');
    // the snapshot history now names exactly the two files on disk
    const snap = JSON.parse(out.get(".loom/snapshots/Catalog.snapshot.json")!);
    expect(snap.migrationHistory.map((h: { version: string }) => h.version)).toEqual([
      "20260101000000",
      "20260101500001",
    ]);
  });

  it("leaves a migration-aware Dapper tree alone — its Initial is on disk", async () => {
    const out = await regen("dapper", ["20260101000000"]);
    const migrations = [...out.keys()].filter((p) => p.startsWith("d/Migrations/"));
    expect(migrations).toEqual([expect.stringMatching(/20260101500001_Catalog_/)]);
  });

  it("is Dapper-only: the same drift on EF is still refused by guard (b)", async () => {
    await expect(regen("efcore", [])).rejects.toThrow(/inconsistent with the snapshot/);
  });
});
