// Every backend on a shared database maps the ONE schema the shared migrations
// derive — whichever backend's migrations created it.  This census makes a new
// backend or persistence adapter choose a side, and it cannot be bypassed: the
// target list is read from the platform registry and the adapter menus, not
// written here.
//
//   - A CANONICAL adapter's emitted migrations carry, statement for statement,
//     the shared Postgres DDL (`renderPgStep`).  Its own behavioural leg boots
//     it on that schema, so it maps any canonical owner's tables.
//   - An adapter in `OWN_LAYOUT_PERSISTENCE` lays tables out its own way, so it
//     must be refused beside another layout by its own
//     `loom.<adapter>-shared-database` diagnostic.  Ecto diverges only on a
//     value object, so it is also run as a non-owner on the shared schema, and
//     its own migrations are compared catalog-for-catalog against it, by the
//     booted shared-database leg (`LOOM_BH_ELIXIR_SCHEMA=shared`).
//
// What this asserts is wiring nothing boots: which DDL each emitter writes, and
// that the leg proving the rest is wired into CI.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_MESSAGES } from "../../src/diagnostics/messages.js";
import { renderPgStep } from "../../src/generator/sql-pg.js";
import {
  availableAdapterNames,
  OWN_LAYOUT_PERSISTENCE,
} from "../../src/platform/adapter-metadata.js";
import { descriptorFor } from "../../src/platform/metadata.js";
import { TARGET_FACTS } from "../../src/platform/target-facts.js";
import type { Platform } from "../../src/ir/types/deployment.js";
import { buildMigrations } from "../../src/system/migrations-builder.js";
import { memorySnapshotStore } from "../../src/system/snapshot.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { expectReach } from "../_helpers/census-reach.js";
import { buildLoomModel } from "../_helpers/index.js";

const REPO = join(import.meta.dirname, "../..");

/** Every table shape the shared schema has: a value object, a value-object
 *  collection, a table-backed part, a reference and a reference collection, an
 *  enum check, a version column. */
const model = (platform: string) => `
system Shared {
  subdomain Sales {
    context Catalog {
      enum Tier { Basic, Pro }
      valueobject Money { amount: decimal  currency: string }
      aggregate Tag with crudish { label: string }
      aggregate Item with crudish, versioned {
        name: string
        note: string?
        tier: Tier
        price: Money
        charges: Money[]
        contains lines: Line[]
        tag: Tag id?
        tags: Tag id[]
        entity Line { sku: string  qty: int }
      }
      repository Items for Item { }
      repository Tags for Tag { }
    }
  }
  api CatalogApi from Sales
  storage primary { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: primary }
  deployable api { platform: ${platform} contexts: [Catalog] dataSources: [catalogState] serves: CatalogApi port: 4000 }
}`;

/** Every (backend, persistence) pair the registry offers: each database-bearing
 *  platform with each persistence adapter on its menu, or its single fixed one. */
function persistenceTargets(): { platform: Platform; adapter: string | undefined }[] {
  const out: { platform: Platform; adapter: string | undefined }[] = [];
  for (const platform of Object.keys(TARGET_FACTS) as Platform[]) {
    if (!descriptorFor(platform).needsDb) continue;
    const adapters = availableAdapterNames(platform, "persistence");
    if (adapters.length === 0) out.push({ platform, adapter: undefined });
    for (const adapter of adapters) out.push({ platform, adapter });
  }
  return out;
}

/** The shared DDL, one statement per entry, as `renderPgStep` writes it. */
async function sharedStatements(): Promise<string[]> {
  const loom = await buildLoomModel(model("node"));
  const steps = buildMigrations(loom.systems[0]!, memorySnapshotStore({}), {}).flatMap(
    (d) => d.steps,
  );
  return steps
    .flatMap((s) => renderPgStep(s).split(/;\s*\n/))
    .map((s) => s.trim().replace(/;$/, ""))
    .filter((s) => s.length > 0);
}

describe("shared-database layout census", () => {
  const targets = persistenceTargets();

  it("reads at least the five backends and both alternate adapters off the registry", () => {
    expectReach("(backend, persistence) targets", targets.length, 7);
    const names = targets.map((t) => `${t.platform}/${t.adapter ?? "-"}`);
    for (const expected of ["node/drizzle", "dotnet/efcore", "dotnet/dapper", "elixir/ecto"]) {
      expect(names).toContain(expected);
    }
    expect(names.some((n) => n.startsWith("python/"))).toBe(true);
    expect(names.some((n) => n.startsWith("java/"))).toBe(true);
  });

  for (const { platform, adapter } of targets) {
    const label = `${platform}${adapter ? ` { persistence: ${adapter} }` : ""}`;
    if (adapter && OWN_LAYOUT_PERSISTENCE.has(adapter)) {
      it(`${label} lays tables out its own way, so a shared-database diagnostic refuses it`, () => {
        expect(Object.keys(DIAGNOSTIC_MESSAGES)).toContain(`loom.${adapter}-shared-database`);
      });
      continue;
    }
    it(`${label} emits the shared DDL statement for statement`, async () => {
      const files = await generateSystemFiles(
        model(adapter ? `${platform} { persistence: ${adapter} }` : platform),
      );
      // C# verbatim strings double each quote; collapse them to compare text.
      const emitted = [...files.values()].join("\n").replaceAll('""', '"');
      const missing = (await sharedStatements()).filter((s) => !emitted.includes(s));
      expect(missing).toEqual([]);
    });
  }

  it("the Ecto layout is proven on the shared schema by the booted shared-database leg in CI", () => {
    const wf = readFileSync(join(REPO, ".github/workflows/behavioral-e2e-elixir.yml"), "utf8");
    expect(wf).toContain("LOOM_BH_ELIXIR_SCHEMA: shared");
    const runner = readFileSync(join(REPO, "test/behavioral/run-elixir.mjs"), "utf8");
    expect(runner).toContain("sharedSchemaMigrate");
  });
});
