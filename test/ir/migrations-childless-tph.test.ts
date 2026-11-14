import { describe, expect, it } from "vitest";
import type {
  MigrationStep,
  SchemaSnapshot,
  TableShape,
} from "../../src/ir/types/migrations-ir.js";
import { buildMigrations, MigrationDestructiveError } from "../../src/system/migrations-builder.js";
import { memorySnapshotStore } from "../../src/system/snapshot.js";
import { buildLoomModel, generateSystemFiles } from "../_helpers/index.js";

// A `sharedTable` base with no shared-table subtype owns an ordinary table with
// no `kind` discriminator; the first subtype adds the column, and dropping the
// last one drops it again.  The MigrationsIR half asserts on the derived steps
// and snapshot.  The ORM half asserts on emitted text, and is the absence /
// wiring class of string assertion: no booted tier observes that a mapping
// names a column the table does not have until the first read of the base, and
// a childless base serves no read.

const CHILD = `
      aggregate Lathe extends Asset with crudish { spindles: int }
      repository Lathes for Lathe { }`;

function src(platform: string, withChild: boolean): string {
  return `
system Plant {
  subdomain Shop {
    context Shop {
      abstract aggregate Asset inheritanceUsing: sharedTable { label: string }${withChild ? CHILD : ""}
      aggregate Note with crudish { text: string }
      repository Notes for Note { }
    }
  }
  api ShopApi from Shop
  storage primary { type: postgres }
  resource shopState { for: Shop, kind: state, use: primary }
  deployable d {
    platform: ${platform}
    contexts: [Shop]
    dataSources: [shopState]
    serves: ShopApi
    port: 4000
  }
}
`;
}

async function snapshotOf(source: string): Promise<SchemaSnapshot> {
  const loom = await buildLoomModel(source);
  return buildMigrations(loom.systems[0]!, memorySnapshotStore({}), {})[0]!.next;
}

async function evolve(
  v1: string,
  v2: string,
  allowDestructive = false,
): Promise<readonly MigrationStep[]> {
  const base = await snapshotOf(v1);
  const loom = await buildLoomModel(v2);
  return buildMigrations(loom.systems[0]!, memorySnapshotStore({ Shop: base }), {
    allowDestructive,
  })[0]!.steps;
}

const assets = (s: SchemaSnapshot): TableShape => {
  const t = s.tables.find((x) => x.name === "assets");
  if (!t) throw new Error("no assets table in the snapshot");
  return t;
};
const columnNames = (t: TableShape): string[] => t.columns.map((c) => c.name);
const assetSteps = (steps: readonly MigrationStep[]) =>
  steps.filter((s) => "table" in s && s.table === "assets");

describe("a childless TPH base is a plain table in MigrationsIR", () => {
  it("owns the table, without a `kind` column", async () => {
    const t = assets(await snapshotOf(src("node", false)));
    expect(columnNames(t)).toEqual(["id", "label", "row_version"]);
  });

  it("a shared-table subtype brings the `kind` column", async () => {
    const t = assets(await snapshotOf(src("node", true)));
    expect(columnNames(t)).toContain("kind");
    expect(t.columns.find((c) => c.name === "kind")?.nullable).toBe(false);
  });

  it("adding the first subtype adds `kind` NOT NULL with no flag: the table has no write path yet", async () => {
    const steps = assetSteps(await evolve(src("node", false), src("node", true)));
    const added = steps.flatMap((s) => (s.op === "addColumn" ? [s.column] : []));
    expect(added.map((c) => c.name).sort()).toEqual(["kind", "spindles"]);
    const kind = added.find((c) => c.name === "kind")!;
    // No default lent: a stray row fails the add instead of acquiring a subtype.
    expect(kind.nullable).toBe(false);
    expect(kind.default).toBeUndefined();
    expect(steps.filter((s) => s.op !== "addColumn")).toEqual([]);
  });

  it("dropping the last subtype drops `kind` — destructive, since the subtype's rows go with it", async () => {
    let refused: unknown;
    try {
      await evolve(src("node", true), src("node", false));
    } catch (e) {
      refused = e;
    }
    expect(refused).toBeInstanceOf(MigrationDestructiveError);
    const steps = assetSteps(await evolve(src("node", true), src("node", false), true));
    const dropped = steps.flatMap((s) => (s.op === "dropColumn" ? [s.name] : []));
    expect(dropped.sort()).toEqual(["kind", "spindles"]);
  });
});

// The ORM layer of every backend maps the same table: the `kind` discriminator
// (column or inheritance mapping) appears exactly when a subtype shares the
// table.
const ORM_FILES: ReadonlyArray<{
  platform: string;
  file: string;
  discriminator: RegExp;
}> = [
  { platform: "node", file: "d/db/schema.ts", discriminator: /text\("kind"\)/ },
  {
    platform: "node { persistence: mikroorm }",
    file: "d/db/entities.ts",
    discriminator: /"kind"|discriminatorColumn/,
  },
  { platform: "python", file: "d/app/db/schema.py", discriminator: /"kind"|polymorphic_on/ },
  {
    platform: "dotnet",
    file: "d/Infrastructure/Persistence/Configurations/AssetConfiguration.cs",
    discriminator: /HasDiscriminator/,
  },
  {
    platform: "java",
    file: "d/src/main/java/com/loom/d/features/assets/Asset.java",
    discriminator: /DiscriminatorColumn|InheritanceType/,
  },
  { platform: "elixir", file: "d/lib/d/shop/asset.ex", discriminator: /field :kind/ },
];

describe("a childless TPH base maps no discriminator on any backend", () => {
  for (const { platform, file, discriminator } of ORM_FILES) {
    it(`${platform}: ${file}`, async () => {
      const childless = (await generateSystemFiles(src(platform, false))).get(file);
      const withChild = (await generateSystemFiles(src(platform, true))).get(file);
      expect(childless, `${file} not emitted`).toBeDefined();
      expect(childless).not.toMatch(discriminator);
      // Control: the same pattern does match once a subtype shares the table,
      // so the absence above is not a pattern that never matches.
      expect(withChild).toMatch(discriminator);
    }, 60_000);
  }
});
