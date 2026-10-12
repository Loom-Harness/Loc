// Phase ⑥ — the demo tenant's first-boot registry row (eval-closure item #26).
// The why, and the other half (the realm attribute), is in
// `src/ir/util/demo-tenant.ts`.
//
// Appended as an ordinary `raw` SeedIR on the context that declares the
// tenancy registry, so every backend's existing seed-datasets path
// (`src/generator/_persistence/seed-datasets.ts` → the per-backend seeder) and
// every "does this context seed?" gate sees it with no backend-specific code.
// `raw`, because only the raw path writes an explicit `id` (D-SEED-XREF) —
// the domain `create` would mint a fresh one that the claim never names.
//
// Conservative: the row is added only when every column it must fill has a
// value this pass can spell as a raw literal; anything else (a value-object
// column, an `X id` reference, an array, an inherited / document /
// event-sourced / non-Postgres registry) leaves the model untouched, and the
// demo user simply has no registry row — the pre-#26 behaviour, minus the
// non-uuid claim.

import type {
  EnrichedAggregateIR,
  EnrichedSubdomainIR,
  ExprIR,
  FieldIR,
  SeedIR,
  SystemIR,
} from "../types/loom-ir.js";
import { DEMO_TENANT_DATASET, DEMO_TENANT_ID, demoTenantClaim } from "../util/demo-tenant.js";

export function applyDemoTenantSeed(m: EnrichedSubdomainIR, sys: SystemIR): EnrichedSubdomainIR {
  if (!demoTenantClaim(sys) || !sys.tenancy) return m;
  const registryName = sys.tenancy.registryName;
  if (!m.contexts.some((c) => c.aggregates.some((a) => a.name === registryName))) return m;
  return {
    ...m,
    contexts: m.contexts.map((c) => {
      const registry = c.aggregates.find((a) => a.name === registryName);
      if (!registry || !registryOnPostgres(c.name, sys)) return c;
      const seed = demoTenantSeed(registry);
      return seed ? { ...c, seeds: [...c.seeds, seed] } : c;
    }),
  };
}

/** The registry context's `state` dataSource is backed by Postgres — the raw
 *  seed path renders Postgres SQL. */
function registryOnPostgres(contextName: string, sys: SystemIR): boolean {
  const ds = sys.dataSources.find((d) => d.contextName === contextName && d.kind === "state");
  if (!ds) return false;
  return sys.storages.find((s) => s.name === ds.storageName)?.type === "postgres";
}

function demoTenantSeed(registry: EnrichedAggregateIR): SeedIR | undefined {
  if (registry.isAbstract || registry.extendsAggregate) return undefined;
  if (registry.persistedAs === "eventLog") return undefined;
  if (registry.savingShape && registry.savingShape !== "relational") return undefined;
  const fields: SeedIR["rows"][number]["fields"] = [
    { name: "id", value: lit("string", DEMO_TENANT_ID) },
  ];
  for (const f of registry.fields) {
    // The tree capability's materialised path: a root row's `dataKey` is its
    // own id (`tenantRegistry` — `root` → `<id>`).
    if (f.name === "dataKey") {
      fields.push({ name: f.name, value: lit("string", DEMO_TENANT_ID) });
      continue;
    }
    if (f.optional || f.type.kind === "optional") continue;
    const value = demoValue(f, registry.name);
    if (!value) return undefined;
    fields.push({ name: f.name, value });
  }
  return {
    dataset: DEMO_TENANT_DATASET,
    path: "raw",
    rows: [{ aggregate: registry.name, fields }],
  };
}

/** A raw-literal value for one required registry column, or `undefined` when
 *  the column's type has no obvious synthetic value. */
function demoValue(f: FieldIR, registryName: string): ExprIR | undefined {
  const t = f.type;
  if (t.kind !== "primitive") return undefined;
  switch (t.name) {
    case "string":
      return lit("string", `Demo ${registryName}`);
    case "int":
    case "long":
    case "decimal":
    case "money":
      return lit(t.name, "0");
    case "bool":
      return lit("bool", "false");
    case "datetime":
      return lit("now", "now");
    case "guid":
      return lit("string", "00000000-0000-0000-0000-000000000000");
    default:
      return undefined;
  }
}

function lit(kind: Extract<ExprIR, { kind: "literal" }>["lit"], value: string): ExprIR {
  return { kind: "literal", lit: kind, value };
}
