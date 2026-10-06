import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";

// Eval item #29 — an `api` no backend deployable `serves:` used to validate
// `0 error(s), 0 warning(s)`, which reads as "served".  `loom.api-unserved`
// makes the dead declaration a warning; the silent cases below are what keep
// it from crying wolf.

const system = (tail: string) => `
system Shop {
  subdomain Sd { context Catalog {
    aggregate Item with crudish { name: string }
    repository Items for Item { }
  } }
  api CatalogApi from Sd
${tail}
}`;

const BACKEND = `
  storage pg { type: postgres }
  resource st { for: Catalog, kind: state, use: pg }
  deployable api { platform: node contexts: [Catalog] dataSources: [st] serves: CatalogApi port: 3000 }`;

async function unserved(src: string) {
  const report = await validate(src);
  return report.diagnostics.filter((d) => d.code === "loom.api-unserved");
}

describe("loom.api-unserved (#29)", () => {
  it("warns on an api no deployable serves, naming it and the backends", async () => {
    const diags = await unserved(system(`  api OrphanApi from Sd\n${BACKEND}`));
    expect(diags).toHaveLength(1);
    expect(diags[0]!.severity).toBe("warning");
    expect(diags[0]!.message).toContain(
      "api 'OrphanApi' is declared but no backend deployable serves it",
    );
    expect(diags[0]!.message).toContain("backends: 'api'");
  });

  it("is silent when every api is served", async () => {
    expect(await unserved(system(BACKEND))).toEqual([]);
  });

  it("warns when the only backend carries no `serves:` clause at all", async () => {
    const diags = await unserved(
      system(`
  storage pg { type: postgres }
  resource st { for: Catalog, kind: state, use: pg }
  deployable api { platform: node contexts: [Catalog] dataSources: [st] port: 3000 }`),
    );
    expect(diags.map((d) => d.message)).toEqual([
      expect.stringContaining("api 'CatalogApi' is declared"),
    ]);
  });

  it("is silent for a domain-only system with no deployables", async () => {
    expect(await unserved(system(""))).toEqual([]);
  });
});
