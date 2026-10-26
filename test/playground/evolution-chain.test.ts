import { describe, expect, it } from "vitest";
import { parseChain } from "../../src/system/migration-chain.js";
import { chainDir, isChainFile, readChainFiles } from "../../web/src/build/chain-files.js";
import { recordMigration, runEvolution } from "../../web/src/build/evolution.js";
import type {
  EvolutionOk,
  EvolutionTree,
  RecordMigrationOk,
  VfsEntry,
} from "../../web/src/build/protocol.js";
import { MemoryVfs } from "../../web/src/vfs/memory-vfs.js";

// The playground's Migrations dock against a committed `migrations/` chain:
// the chain's heads are the schema baseline, the model's `migration { … }`
// intents reach the diff, and "Record migration" writes the same entries
// `ddd migrate add` would.

const ENTRY = "/workspace/main.ddd";

const V1 = `subdomain Sales {
  context Sales {
    aggregate Customer with crudish { name: string email: string }
  }
}
system Shop {
  storage primary { type: postgres }
  resource salesState { for: Sales, kind: state, use: primary }
  deployable api { platform: node contexts: [Sales] dataSources: [salesState] port: 3000 }
}`;

// Two columns of one table renamed at once — a pair the rename heuristic
// cannot collapse, so only the declared intents turn it into renames.
const V2_RENAMED = `${V1.replace("name: string email: string", "fullName: string contactEmail: string")}
migration "rename-customer-fields" {
  Customer.name -> fullName
  Customer.email -> contactEmail
}`;

const V2_ADDED = V1.replace("email: string", "email: string phone: string?");

function tree(source: string, chain: VfsEntry[] = []): EvolutionTree {
  return { entryPath: ENTRY, files: [{ kind: "file", path: ENTRY, content: source }, ...chain] };
}

async function record(source: string, name: string, chain: VfsEntry[] = []): Promise<VfsEntry[]> {
  const r = await recordMigration({ current: tree(source, chain), name, now: "20261025120000" });
  expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  const files = (r as RecordMigrationOk).files.map(
    (f): VfsEntry => ({ kind: "file", path: f.path, content: f.content }),
  );
  return [...chain, ...files];
}

describe("chain files in the VFS", () => {
  it("live beside the entry, one level deep, .json only", () => {
    expect(chainDir("/workspace/main.ddd")).toBe("/workspace/migrations");
    expect(chainDir("/workspace/app/main.ddd")).toBe("/workspace/app/migrations");
    const dir = "/workspace/migrations";
    expect(isChainFile(dir, "/workspace/migrations/1_a_initial.json")).toBe(true);
    expect(isChainFile(dir, "/workspace/migrations/old/1_a_initial.json")).toBe(false);
    expect(isChainFile(dir, "/workspace/migrations/notes.md")).toBe(false);
    const vfs = new MemoryVfs();
    vfs.hydrate([
      { kind: "file", path: ENTRY, content: V1 },
      { kind: "file", path: "/workspace/migrations/b.json", content: "{}" },
      { kind: "file", path: "/workspace/migrations/a.json", content: "{}" },
    ]);
    expect(readChainFiles(vfs, ENTRY)?.map((f) => f.name)).toEqual(["a.json", "b.json"]);
    expect(readChainFiles(vfs, "/workspace/app/main.ddd")).toBeUndefined();
  });
});

describe("recordMigration — the playground's `ddd migrate add`", () => {
  it("starts the chain with Initial, then records a named generation on top", async () => {
    const first = await record(V1, "initial");
    expect(first.map((f) => f.path)).toEqual([
      "/workspace/migrations/20261025120000_sales_initial.json",
    ]);
    const both = await record(V2_ADDED, "add-phone", first);
    const chain = parseChain(
      both.map((f) => ({
        name: f.path.slice("/workspace/migrations/".length),
        content: (f as { content: string }).content,
      })),
    );
    expect(chain.entries.map((e) => `${e.module}/${e.name}`)).toEqual([
      "Sales/Initial",
      "Sales/AddPhone",
    ]);
  });

  it("records nothing when the model matches the head", async () => {
    const first = await record(V1, "initial");
    const r = await recordMigration({
      current: tree(V1, first),
      name: "noop",
      now: "20261025130000",
    });
    expect(r.ok).toBe(true);
    expect((r as RecordMigrationOk).files).toEqual([]);
  });

  it("refuses a name that is not kebab-case, as a diagnostic", async () => {
    const r = await recordMigration({ current: tree(V1), name: "AddPhone", now: "20261025120000" });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => /kebab-case/.test(d.message))).toBe(true);
  });
});

describe("runEvolution against a committed chain", () => {
  it("uses the chain's head as the schema baseline and reports its status", async () => {
    const chain = await record(V1, "initial");
    // No baseline SOURCE at all: the chain alone is the schema baseline.
    const r = (await runEvolution({
      baseline: null,
      current: tree(V2_ADDED, chain),
    })) as EvolutionOk;
    expect(r.ok).toBe(true);
    expect(r.hasBaseline).toBe(true);
    expect(r.migrations.map((m) => m.name)).not.toContain("Initial");
    const ops = r.migrations.flatMap((m) => m.steps.map((s) => s.op));
    expect(ops).toEqual(["addColumn"]);
    expect(r.chain).toEqual({
      entries: 1,
      head: { version: "20261025120000", module: "Sales", name: "Initial" },
      unrecordedSteps: 1,
    });
  });

  it("passes the model's rename intents: a declared rename is a RENAME, not drop + add", async () => {
    const chain = await record(V1, "initial");
    const r = (await runEvolution({
      baseline: tree(V1),
      current: tree(V2_RENAMED, chain),
    })) as EvolutionOk;
    expect(r.ok, JSON.stringify((r as { diagnostics: unknown }).diagnostics)).toBe(true);
    const ops = r.migrations.flatMap((m) => m.steps.map((s) => s.op));
    expect(ops).toEqual(["renameColumn", "renameColumn"]);
    expect(r.migrations.some((m) => m.destructive)).toBe(false);
  });

  it("passes intents without a chain too (baseline source only)", async () => {
    const r = (await runEvolution({
      baseline: tree(V1),
      current: tree(V2_RENAMED),
    })) as EvolutionOk;
    expect(r.ok).toBe(true);
    expect(r.chain).toBeNull();
    expect(r.migrations.flatMap((m) => m.steps.map((s) => s.op))).toEqual([
      "renameColumn",
      "renameColumn",
    ]);
  });

  it("reports two heads with both file names, and the record refuses them", async () => {
    const base = await record(V1, "initial");
    const a = await record(V2_ADDED, "add-phone", base);
    const b = await record(
      V1.replace("email: string", "email: string vip: bool?"),
      "add-vip",
      base,
    );
    // `b` was recorded a second after `a`, on another branch: same parent.
    const aEntry = a.at(-1)! as { path: string; content: string };
    const bEntry = b.at(-1)! as { path: string; content: string };
    const aVersion = /"version": "(\d+)"/.exec(aEntry.content)![1]!;
    const bVersion = String(BigInt(aVersion) + 1n);
    const bPath = bEntry.path.replace(/\d{14}_/, `${bVersion}_`);
    const merged: VfsEntry[] = [
      ...a,
      {
        kind: "file",
        path: bPath,
        content: bEntry.content.replace(/"version": "\d+"/, `"version": "${bVersion}"`),
      },
    ];
    const base_ = (p: string) => p.slice("/workspace/migrations/".length);
    const r = (await runEvolution({ baseline: null, current: tree(V1, merged) })) as EvolutionOk;
    expect(r.ok).toBe(true);
    expect(r.chain?.forkHeads).toEqual([base_(aEntry.path), base_(bPath)]);
    const rec = await recordMigration({
      current: tree(V1, merged),
      name: "x",
      now: "20261027000000",
    });
    expect(rec.ok).toBe(false);
    expect(
      rec.diagnostics.some((d) => /two heads/.test(d.message) && /migrate rebase/.test(d.message)),
    ).toBe(true);
  });

  it("a chain that does not read is an error, never a silent 'no baseline'", async () => {
    const broken: VfsEntry[] = [
      {
        kind: "file",
        path: "/workspace/migrations/20261025120000_sales_initial.json",
        content: "<<<<<<< HEAD",
      },
    ];
    const r = await runEvolution({ baseline: tree(V1), current: tree(V2_ADDED, broken) });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.some((d) => d.code === "loom.migration-chain-invalid")).toBe(true);
  });
});

describe("a model the IR validator refuses is never diffed or recorded", () => {
  // `index:` still names `email` after the field was renamed: the AST checks
  // pass, phase ⑦ refuses it, and the migration it implies would rebuild an
  // index on a column that no longer exists.
  const STALE_INDEX = V1.replace("email: string", "contactEmail: string").replace(
    "use: primary }",
    "use: primary, index: [Customer.email] }",
  );

  it("refuses to record, with the validator's code, as `ddd migrate add` does", async () => {
    const chain = await record(V1, "initial");
    const r = await recordMigration({
      current: tree(STALE_INDEX, chain),
      name: "rename-email",
      now: "20261025130000",
    });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toContain("loom.resource-index-unknown-column");
  });

  it("refuses to diff the live tree", async () => {
    const r = await runEvolution({ baseline: tree(V1), current: tree(STALE_INDEX) });
    expect(r.ok).toBe(false);
    expect(r.diagnostics.map((d) => d.code)).toContain("loom.resource-index-unknown-column");
  });

  it("still diffs against a pinned baseline the validator would refuse", async () => {
    const r = await runEvolution({ baseline: tree(STALE_INDEX), current: tree(V2_ADDED) });
    expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  });
});
