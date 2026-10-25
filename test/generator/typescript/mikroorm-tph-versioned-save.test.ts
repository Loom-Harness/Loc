// `persistence: mikroorm` — the versioned save's guarded `nativeUpdate` on a TPH
// concrete must pin `kind` in its WHERE.  With only `{ id, version }` a
// `carRepo.save(x)` on a Truck's id matched that row, rewrote its columns and
// flipped its `kind` to "Car".  The drizzle twin
// (`repository-save-builder.ts`) scopes the write by `kind`; a foreign-subtype
// id must match nothing and surface as ConcurrencyError.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = (body: string): string => `
system S {
  subdomain D {
    context Fleet {
      ${body}
    }
  }
  api A from D
  storage primary { type: postgres }
  resource st { for: Fleet, kind: state, use: primary }
  deployable api {
    platform: node { persistence: mikroorm }
    contexts: [Fleet]
    dataSources: [st]
    serves: A
    port: 3000
  }
}`;

const TPH = SRC(`
      abstract aggregate Vehicle inheritanceUsing: sharedTable with versioned { name: string }
      aggregate Car extends Vehicle with crudish, versioned { doors: int }
      aggregate Truck extends Vehicle with crudish, versioned { payloadKg: int }
      repository Cars for Car { }
      repository Trucks for Truck { }`);

const PLAIN = SRC(`
      aggregate Bike with crudish, versioned { name: string }
      repository Bikes for Bike { }`);

async function repo(src: string, agg: string): Promise<string> {
  const all = await generateSystemFiles(src);
  const key = [...all.keys()].find((k) => k.endsWith(`db/repositories/${agg}-repository.ts`));
  expect(key, `${agg}-repository.ts not emitted`).toBeDefined();
  return all.get(key!)!;
}

const nativeUpdate = (src: string): string =>
  src.split("\n").find((l) => l.includes("em.nativeUpdate(")) ?? "";

describe("mikroorm TPH versioned save", () => {
  it("scopes the guarded nativeUpdate by the concrete's kind", async () => {
    const car = nativeUpdate(await repo(TPH, "car"));
    expect(car, "guarded nativeUpdate emitted").not.toEqual("");
    expect(car).toMatch(/\{ id: aggregate\.id as string, version: expected, kind: "Car" \}/);
    expect(nativeUpdate(await repo(TPH, "truck"))).toContain('kind: "Truck" }');
  });

  it("leaves a non-TPH aggregate's guard untouched", async () => {
    const bike = nativeUpdate(await repo(PLAIN, "bike"));
    expect(bike, "guarded nativeUpdate emitted").not.toEqual("");
    expect(bike).toContain("{ id: aggregate.id as string, version: expected },");
  });
});
