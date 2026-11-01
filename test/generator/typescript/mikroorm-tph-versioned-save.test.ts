// `persistence: mikroorm` — the versioned save's guarded `nativeUpdate` on a TPH
// concrete runs through the CONCRETE's Row class.  The root declares the
// discriminator (`discriminatorColumn` + `discriminatorMap`), so the ORM scopes
// the UPDATE to the subtype's `kind` by itself: with only `{ id, version }` a
// `carRepo.save(x)` on a Truck's id would otherwise match that row, rewrite its
// columns and flip its `kind`.  A foreign-subtype id matches nothing and
// surfaces as ConcurrencyError.  The statement bypasses the READ filters
// (`{ filters: false }`): it is scoped by id and version alone, so a row the
// read scope hides (soft-deleted, an `ignoring`-loaded aggregate) is still
// savable.

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

const probe = (src: string): string =>
  src.split("\n").find((l) => l.includes("em.findOne(") && l.includes("filters: false")) ?? "";

describe("mikroorm TPH versioned save", () => {
  it("updates through the concrete's Row, leaving the kind scope to the ORM", async () => {
    const car = nativeUpdate(await repo(TPH, "car"));
    expect(car, "guarded nativeUpdate emitted").not.toEqual("");
    expect(car).toContain(
      "em.nativeUpdate(CarRow, { id: aggregate.id as string, version: expected },",
    );
    expect(car, "the UPDATE never writes the discriminator").not.toMatch(/\bkind\b/);
    const truck = nativeUpdate(await repo(TPH, "truck"));
    expect(truck).toContain("em.nativeUpdate(TruckRow,");
    expect(truck).not.toMatch(/\bkind\b/);
  });

  it("bypasses the read filters on the existence probe and the update", async () => {
    const src = await repo(TPH, "car");
    // The probe asks a primary-key question about the whole table: the root's
    // Row, so a foreign-subtype id is found (and the UPDATE then matches 0 rows).
    expect(probe(src)).toContain(
      "em.findOne(VehicleRow, { id: aggregate.id as string }, { filters: false })",
    );
    expect(nativeUpdate(src)).toContain("{ filters: false });");
  });

  it("leaves a non-TPH aggregate's guard untouched", async () => {
    const bike = nativeUpdate(await repo(PLAIN, "bike"));
    expect(bike, "guarded nativeUpdate emitted").not.toEqual("");
    expect(bike).toContain("{ id: aggregate.id as string, version: expected },");
  });
});
