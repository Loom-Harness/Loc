import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { buildLoomModelUnchecked } from "../../_helpers/ir.js";

// "Every write evicts" holds only where the writing process can evict:
// `loom.cache-writer-not-evicting` and `loom.cache-in-memory-shared` refuse the
// topologies where it cannot, and the fixed topology each message names is
// accepted.  (The firing census proves each code fires; this file proves the
// one-line fix the message gives clears it, and that look-alikes stay clean.)

const model = (storageType: string, deployables: string) => `
system S {
  subdomain D { context C {
    aggregate Thing with crudish { label: string }
  } }
  api A from D
  storage primary { type: postgres }
  storage other { type: postgres }
  storage hot { type: ${storageType} }
  resource cState { for: C, kind: state, use: primary }
  resource cOther { for: C, kind: state, use: other }
  resource cCache { for: C, kind: cache, use: hot }
  ${deployables}
}`;

async function cacheCodes(source: string): Promise<string[]> {
  const ir = await buildLoomModelUnchecked(source, "probes the cache topology diagnostics");
  return validateLoomModel(ir)
    .map((d) => d.code)
    .filter((c) => c === "loom.cache-writer-not-evicting" || c === "loom.cache-in-memory-shared");
}

const api = (ds: string) =>
  `deployable api { platform: node, contexts: [C], dataSources: [${ds}], serves: A, port: 3000 }`;
const worker = (ds: string) =>
  `deployable worker { platform: python, contexts: [C], dataSources: [${ds}], port: 3001 }`;

describe("cache topology", () => {
  it("refuses a writer on the cache's database that does not list the cache", async () => {
    expect(await cacheCodes(model("redis", api("cState, cCache") + worker("cState")))).toEqual([
      "loom.cache-writer-not-evicting",
    ]);
  });

  it("accepts it once the writer lists the cache (it then evicts)", async () => {
    expect(
      await cacheCodes(model("redis", api("cState, cCache") + worker("cState, cCache"))),
    ).toEqual([]);
  });

  it("accepts a deployable that hosts the context on another database", async () => {
    expect(await cacheCodes(model("redis", api("cState, cCache") + worker("cOther")))).toEqual([]);
  });

  it("refuses an inMemory cache listed by two deployables", async () => {
    expect(
      await cacheCodes(model("inMemory", api("cState, cCache") + worker("cState, cCache"))),
    ).toEqual(["loom.cache-in-memory-shared"]);
  });

  it("accepts an inMemory cache listed by the one deployable that hosts the context", async () => {
    expect(await cacheCodes(model("inMemory", api("cState, cCache")))).toEqual([]);
  });
});
