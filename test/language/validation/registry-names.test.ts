// Gate for D-REGISTRY-NAMES (docs/decisions).
// Storage types and design packs are identifiers checked against their
// registries, not grammar keywords: `storage { type: … }` against the
// sourceType registry (`src/util/source-types.ts`), a bare `design:` against
// the built-in pack families (`BUILTIN_PACK_LATEST`, mirroring `designs/`).
// An unknown name parses and is refused by the validator, listing the known
// ones; the quoted `design:` form stays the custom-pack / pinned spelling.

import { afterEach, describe, expect, it } from "vitest";
import {
  _unregisterSourceTypeForTests,
  registerSourceType,
} from "../../../src/util/source-types.js";
import { parseString } from "../../_helpers/parse.js";

const storageSys = (type: string) => `
system S {
  subdomain M { context C { aggregate A with crudish { n: string } repository As for A { } } }
  storage db { type: ${type} }
  resource st { for: C, kind: state, use: db }
  deployable api { platform: node, contexts: [C], dataSources: [st], port: 3000 }
}`;

const designSys = (design: string) => `
system S {
  subdomain Sales { context Orders { aggregate Order { total: int } } }
  ui Web with scaffold(subdomains: [Sales]) {}
  storage primary { type: postgres }
  resource st { for: Orders, kind: state, use: primary }
  deployable api { platform: node contexts: [Orders] dataSources: [st] port: 3000 }
  deployable web { platform: react targets: api ui: Web design: ${design} port: 3001 }
}`;

async function codes(src: string) {
  const { diagnostics } = await parseString(src);
  const parseErrors = diagnostics.filter(
    (d) => (d.data as { code?: string } | undefined)?.code === "parsing-error",
  );
  expect(parseErrors).toEqual([]);
  return diagnostics.filter((d) => d.severity === 1);
}

describe("storage type is a registry-checked identifier", () => {
  afterEach(() => _unregisterSourceTypeForTests("pluginStore"));

  it("refuses an unknown type with loom.storage-type-unknown, listing the known types", async () => {
    const errs = await codes(storageSys("postgress"));
    const hit = errs.filter((d) => d.code === "loom.storage-type-unknown");
    expect(hit).toHaveLength(1);
    expect(hit[0]!.message).toContain("'postgress'");
    expect(hit[0]!.message).toContain("postgres, rabbitmq");
    // One error at the cause: the resource's kind check does not repeat it.
    expect(errs.map((d) => d.code)).not.toContain("loom.resource-kind-storage-mismatch");
  });

  it("refuses the types that bind no kind (search / analytics / nats)", async () => {
    for (const t of ["elastic", "meilisearch", "clickhouse", "bigquery", "nats"]) {
      const errs = await codes(storageSys(t));
      expect(
        errs.map((d) => d.code),
        t,
      ).toContain("loom.storage-type-unknown");
    }
  });

  it("accepts a registered type, and a plugin-registered one with no grammar edit", async () => {
    expect((await codes(storageSys("postgres"))).map((d) => d.code)).toEqual([]);
    registerSourceType({
      name: "pluginStore",
      supports: { database: { capabilities: new Set(["state"]), interfaces: new Set(["sql"]) } },
    });
    const errs = await codes(storageSys("pluginStore"));
    expect(errs.map((d) => d.code)).not.toContain("loom.storage-type-unknown");
  });
});

describe("design pack is a registry-checked identifier", () => {
  it("refuses an unknown bare pack with loom.design-pack-unknown, listing the families", async () => {
    const hit = (await codes(designSys("mantien"))).filter(
      (d) => d.code === "loom.design-pack-unknown",
    );
    expect(hit).toHaveLength(1);
    expect(hit[0]!.message).toContain("'mantien'");
    expect(hit[0]!.message).toContain("mantine, mui");
  });

  it("accepts a built-in bare pack", async () => {
    expect((await codes(designSys("shadcn"))).map((d) => d.code)).toEqual([]);
  });

  it("keeps the quoted form a custom pack path (warning, not loom.design-pack-unknown)", async () => {
    const { diagnostics } = await parseString(designSys('"./design/mantien"'));
    expect(diagnostics.map((d) => d.code)).not.toContain("loom.design-pack-unknown");
    expect(diagnostics.map((d) => d.code)).toContain("loom.design-pack-custom-unchecked");
  });
});
