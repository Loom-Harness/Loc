import { describe, expect, it } from "vitest";
import type { SchemaSnapshot } from "../../src/ir/types/migrations-ir.js";
import {
  BASE_VERSION,
  type ChainEntry,
  chainMigrations,
  EMPTY_CHAIN,
  entryFileName,
  headSnapshots,
  INITIAL_RESERVATION,
  type MigrationChain,
  MigrationChainError,
  MigrationDriftError,
  parseChain,
  recordGeneration,
  serializeEntry,
} from "../../src/system/migration-chain.js";
import type { MigrationDelta } from "../../src/system/migrations-builder.js";
import { generateSystemFiles, recordChain } from "../_helpers/generate.js";

// ---------------------------------------------------------------------------
// The committed migration chain (`src/system/migration-chain.ts`): numbering,
// the one-list rule, and what `generate system` does with a chain.
// ---------------------------------------------------------------------------

const schema = (...tables: string[]): SchemaSnapshot => ({
  schemaVersion: 1,
  tables: tables.map((name) => ({
    name,
    columns: [{ name: "id", type: { kind: "uuid" }, nullable: false }],
    primaryKey: ["id"],
    foreignKeys: [],
    indexes: [],
  })),
});

const delta = (module: string, initial: boolean, ...tables: string[]): MigrationDelta => ({
  module,
  storageName: "",
  baseline: initial ? null : schema(),
  next: schema(...tables),
  steps: tables.map((name) => ({ op: "dropTable" as const, name })),
  name: "ignored",
});

const files = (chain: MigrationChain) =>
  chain.entries.map((e) => ({ name: entryFileName(e), content: serializeEntry(e) }));

describe("recordGeneration — numbering", () => {
  it("numbers from the clock, reserving INITIAL_RESERVATION after each initial", () => {
    const entries = recordGeneration(EMPTY_CHAIN, [delta("A", true, "a"), delta("B", true, "b")], {
      name: "initial",
      now: "20261025120000",
    });
    expect(entries.map((e) => e.version)).toEqual([
      "20261025120000",
      String(20261025120000n + INITIAL_RESERVATION),
    ]);
    expect(entries.map((e) => e.parent)).toEqual([null, "20261025120000"]);
    expect(entries.map((e) => e.name)).toEqual(["Initial", "Initial"]);
  });

  it("numbers above the head when the clock is behind it", () => {
    const first = recordGeneration(EMPTY_CHAIN, [delta("A", true, "a")], {
      name: "initial",
      now: "20261025120000",
    });
    const chain = { entries: first };
    const [next] = recordGeneration(chain, [delta("A", false, "b")], {
      name: "add-b",
      now: "20200101000000",
    });
    expect(BigInt(next!.version)).toBe(20261025120000n + INITIAL_RESERVATION);
    expect(next!.parent).toBe("20261025120000");
    expect(next!.name).toBe("AddB");
  });

  it("records nothing for a delta with no steps", () => {
    const entries = recordGeneration(EMPTY_CHAIN, [{ ...delta("A", true), steps: [] }], {
      name: "initial",
      now: BASE_VERSION,
    });
    expect(entries).toEqual([]);
  });

  it("refuses a name that is not kebab-case", () => {
    expect(() =>
      recordGeneration(EMPTY_CHAIN, [delta("A", true, "a")], { name: "AddB", now: BASE_VERSION }),
    ).toThrow(MigrationChainError);
  });

  it("refuses a name the module already has", () => {
    const chain = {
      entries: recordGeneration(EMPTY_CHAIN, [delta("A", true, "a")], {
        name: "initial",
        now: BASE_VERSION,
      }),
    };
    const once = {
      entries: [
        ...chain.entries,
        ...recordGeneration(chain, [delta("A", false, "b")], { name: "add-b", now: BASE_VERSION }),
      ],
    };
    expect(() =>
      recordGeneration(once, [delta("A", false, "c")], { name: "add-b", now: BASE_VERSION }),
    ).toThrow(/already has a migration named AddB/);
  });

  it("marks an entry recorded under --allow-destructive", () => {
    const [e] = recordGeneration(EMPTY_CHAIN, [delta("A", true, "a")], {
      name: "initial",
      now: BASE_VERSION,
      allowDestructive: true,
    });
    expect(e!.allowDestructive).toBe(true);
    expect(JSON.parse(serializeEntry(e!)).allowDestructive).toBe(true);
  });
});

describe("parseChain — one list", () => {
  const twoGenerations = (): MigrationChain => {
    const first = recordGeneration(EMPTY_CHAIN, [delta("A", true, "a")], {
      name: "initial",
      now: BASE_VERSION,
    });
    const second = recordGeneration({ entries: first }, [delta("A", false, "b")], {
      name: "add-b",
      now: BASE_VERSION,
    });
    return { entries: [...first, ...second] };
  };

  it("round-trips a recorded chain, in order whatever the file order", () => {
    const chain = twoGenerations();
    const parsed = parseChain([...files(chain)].reverse());
    expect(parsed.entries.map((e) => e.version)).toEqual(chain.entries.map((e) => e.version));
  });

  it("ignores files that are not .json", () => {
    const parsed = parseChain([...files(twoGenerations()), { name: "README.md", content: "#" }]);
    expect(parsed.entries).toHaveLength(2);
  });

  it("refuses two heads — what two branches that each recorded a migration look like", () => {
    const chain = twoGenerations();
    const [root, child] = chain.entries as [ChainEntry, ChainEntry];
    const sibling: ChainEntry = {
      ...child,
      version: String(BigInt(child.version) + 1n),
      name: "AddC",
    };
    expect(() => parseChain(files({ entries: [root, child, sibling] }))).toThrow(/two heads/);
  });

  it("refuses a parent that is not in the directory", () => {
    const [, child] = twoGenerations().entries as [ChainEntry, ChainEntry];
    expect(() => parseChain(files({ entries: [child] }))).toThrow(/names parent/);
  });

  it("refuses an entry numbered at or below its parent", () => {
    const [root, child] = twoGenerations().entries as [ChainEntry, ChainEntry];
    const bad: ChainEntry = { ...child, version: root.version, parent: root.version };
    expect(() =>
      parseChain([
        { name: entryFileName(root), content: serializeEntry(root) },
        { name: entryFileName(bad), content: serializeEntry({ ...bad }) },
      ]),
    ).toThrow(MigrationChainError);
  });

  it("refuses a file whose name does not match its contents", () => {
    const [root] = twoGenerations().entries as [ChainEntry];
    expect(() => parseChain([{ name: "renamed.json", content: serializeEntry(root) }])).toThrow(
      /file name must be/,
    );
  });

  it("refuses unparseable JSON, naming the file", () => {
    expect(() => parseChain([{ name: "x.json", content: "<<<<<<< HEAD" }])).toThrow(
      /migrations\/x\.json is not valid JSON/,
    );
  });

  it("gives each module's head schema as the next baseline", () => {
    const chain = twoGenerations();
    expect(
      headSnapshots(chain)
        .read("A")
        ?.tables.map((t) => t.name),
    ).toEqual(["b"]);
    expect(headSnapshots(chain).read("B")).toBeNull();
  });

  it("renders every entry with the module's previous schema as its baseline", () => {
    const [first, second] = chainMigrations(twoGenerations());
    expect(first!.baseline).toBeNull();
    expect(second!.baseline?.tables.map((t) => t.name)).toEqual(["a"]);
  });
});

describe("generate system with a chain", () => {
  const model = (fields: string) => `system S {
  subdomain Sales {
    context Sales {
      aggregate Order with crudish { ${fields} }
      repository Orders for Order {}
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable api { platform: node  contexts: [Sales]  dataSources: [st]  serves: SalesApi  port: 3000 }
}`;
  const V1 = model("label: string");
  const V2 = model("label: string  note: string?");

  it("renders every recorded generation, from the chain alone", async () => {
    const out = await generateSystemFiles(V2, { migrationChain: await recordChain([V1, V2]) });
    const sql = [...out.keys()].filter((k) => /db\/migrations\/[^/]+\.sql$/.test(k)).sort();
    expect(sql).toEqual([
      `api/db/migrations/${BASE_VERSION}_sales_initial.sql`,
      `api/db/migrations/${String(BigInt(BASE_VERSION) + INITIAL_RESERVATION)}_sales_gen1.sql`,
    ]);
    expect(out.get(sql[1]!)).toContain('ADD COLUMN "note"');
  });

  it("refuses a model that has moved past the chain's head", async () => {
    // Mutation-checked: removing the drift check in `systemMigrations` makes
    // this generate render the stale chain silently.
    await expect(
      generateSystemFiles(V2, { migrationChain: await recordChain([V1]) }),
    ).rejects.toThrow(MigrationDriftError);
  });

  it("without a chain, renders each module's initial migration from the model", async () => {
    const out = await generateSystemFiles(V2);
    const sql = [...out.keys()].filter((k) => /db\/migrations\/[^/]+\.sql$/.test(k));
    expect(sql).toEqual([`api/db/migrations/${BASE_VERSION}_sales_initial.sql`]);
    expect(out.get(sql[0]!)).toContain('"note"');
  });

  it("writes no migration state into the output tree", async () => {
    const out = await generateSystemFiles(V2, { migrationChain: await recordChain([V1, V2]) });
    expect([...out.keys()].filter((k) => k.startsWith(".loom/snapshots/"))).toEqual([]);
  });
});
