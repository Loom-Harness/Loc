import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { bootPlan, DEFAULT_STORAGE } from "../../web/src/build/boot-plan.js";
import { migrationPlan, recordMigration } from "../../web/src/build/evolution.js";
import type {
  EvolutionTree,
  MigrationPlanOk,
  RecordMigrationOk,
  StoragePlan,
} from "../../web/src/build/protocol.js";
import type { BundleOk } from "../../web/src/bundle/protocol.js";
import type { VfsEntry } from "../../web/src/vfs/types.js";

// ---------------------------------------------------------------------------
// One playground database per `storage`, not per deployable: the Node
// deployables bound to one storage share its database, which holds the union
// of the modules they host.
// ---------------------------------------------------------------------------

const ENTRY = "/workspace/main.ddd";
const sharedStorage = readFileSync(
  path.resolve(__dirname, "../../web/src/examples/shared-storage-system.ddd"),
  "utf8",
);

function tree(source: string, chain: VfsEntry[] = []): EvolutionTree {
  return { entryPath: ENTRY, files: [{ kind: "file", path: ENTRY, content: source }, ...chain] };
}

async function storages(source: string): Promise<StoragePlan[]> {
  const rec = await recordMigration({
    current: tree(source),
    name: "initial",
    now: "20261108120000",
    allowDestructive: false,
  });
  expect(rec.ok, JSON.stringify(rec.diagnostics)).toBe(true);
  const chain = (rec as RecordMigrationOk).files.map(
    (f): VfsEntry => ({ kind: "file", path: f.path, content: f.content }),
  );
  const r = await migrationPlan({ current: tree(source, chain) });
  expect(r.ok, JSON.stringify(r.diagnostics)).toBe(true);
  return (r as MigrationPlanOk).storages;
}

const ids = (s: StoragePlan): string[] =>
  s.plan.kind === "chain" ? s.plan.units.map((u) => u.id) : [];

const TWO_STORAGES = `subdomain Sales {
  context Sales { aggregate Customer with crudish { name: string } }
}
subdomain Billing {
  context Billing { aggregate Invoice with crudish { total: int } }
}
system Shop {
  storage salesDb { type: postgres }
  storage billingDb { type: postgres }
  resource salesState { for: Sales, kind: state, use: salesDb }
  resource billingState { for: Billing, kind: state, use: billingDb }
  deployable sales { platform: node contexts: [Sales] dataSources: [salesState] port: 3000 }
  deployable billing { platform: node contexts: [Billing] dataSources: [billingState] port: 3001 }
}`;

describe("migrationPlan storages", () => {
  it("the shared-storage example: two Node deployables, one database", async () => {
    const out = await storages(sharedStorage);
    expect(out.map((s) => ({ key: s.key, deployables: s.deployables }))).toEqual([
      { key: "primary", deployables: ["admin", "storefront"] },
    ]);
    expect(ids(out[0]!)).toEqual(["20261108120000_catalog_initial"]);
  });

  it("separate storages get separate databases, each with only its modules", async () => {
    const out = await storages(TWO_STORAGES);
    expect(out.map((s) => [s.key, s.deployables, ids(s)])).toEqual([
      ["salesDb", ["sales"], ["20261108120000_sales_initial"]],
      ["billingDb", ["billing"], ["20261109120000_billing_initial"]],
    ]);
  });
});

const ok = (code: string): BundleOk => ({
  ok: true,
  kind: "hono",
  code,
  size: code.length,
  durationMs: 0,
  fetchedUrls: [],
  diagnostics: [],
});

describe("bootPlan", () => {
  const chain = { kind: "chain" as const, units: [], unrecorded: null };

  it("binds each backend to its storage and opens only bound storages", () => {
    const { plan, islands } = bootPlan(
      [
        { slug: "reader", entry: "reader/http/index.ts", bundle: ok("r") },
        { slug: "writer", entry: "writer/http/index.ts", bundle: ok("w") },
      ],
      chain,
      [
        { key: "primary", deployables: ["writer", "reader"], plan: chain },
        { key: "deployable:other", deployables: ["other"], plan: chain },
      ],
      (key) => ({ dataDir: `opfs-ahp://loom-${key}`, island: key }),
    );
    expect(plan.storages.map((s) => s.key)).toEqual(["primary"]);
    expect(plan.backends).toEqual([
      { slug: "reader", bundleCode: "r", storage: "primary" },
      { slug: "writer", bundleCode: "w", storage: "primary" },
    ]);
    expect(islands).toEqual(["primary"]);
  });

  it("a source without a system boots its one backend on the default storage", () => {
    const { plan, islands } = bootPlan(
      [{ slug: "", entry: "http/index.ts", bundle: ok("x") }],
      { kind: "unversioned" },
      [],
      () => ({ dataDir: ":memory:", island: null }),
    );
    expect(plan.storages).toEqual([
      { key: DEFAULT_STORAGE, dataDir: ":memory:", migrations: { kind: "unversioned" } },
    ]);
    expect(plan.backends[0]?.storage).toBe(DEFAULT_STORAGE);
    expect(islands).toEqual([]);
  });
});
