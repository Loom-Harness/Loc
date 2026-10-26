// `persistence: mikroorm` declares an aggregate's whole read scope ONCE, on its
// `EntitySchema`, as named `default: true` schema filters — and a TPH hierarchy
// as native single-table inheritance (`discriminatorColumn` + `discriminatorMap`
// on an abstract root, one `extends` schema per concrete).  The repositories
// then state only their own `where`:
//
//   - `ignoring X` is `{ filters: { X: false } }`;
//   - a subtype's filter is hosted on the ROOT and guarded by the subtype's
//     discriminator, because MikroORM applies a filter declared on a subclass
//     only to queries OF that subclass (a retired `Car` would leak from
//     `find(Vehicle)`);
//   - a tenancy predicate reads the request principal when the query RUNS, so a
//     query with no principal throws instead of reading unscoped.
//
// The fixture is the epic-#3954 behavioural one, so the shapes asserted here are
// the ones its wire golden is proven against at runtime.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";
import { corpusSourceFor } from "../../fixtures/corpus/harness.js";

async function emitted(feature: string): Promise<Map<string, string>> {
  return generateSystemFiles(corpusSourceFor(feature, "node", "mikroorm"));
}

const file = (files: Map<string, string>, suffix: string): string => {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key!)!;
};

describe("mikroorm entities — TPH as native single-table inheritance", () => {
  it("declares an abstract root with the discriminator column and map", async () => {
    const e = file(await emitted("inheritance-read-restrictions"), "db/entities.ts");
    expect(e).toContain("export const VehicleRowSchema = new EntitySchema<VehicleRow>({");
    expect(e).toContain("abstract: true,");
    expect(e).toContain('discriminatorColumn: "kind",');
    expect(e).toContain('discriminatorMap: { "Car": CarRow, "Truck": TruckRow },');
  });

  it("declares each concrete as an `extends` schema with only its own columns", async () => {
    const e = file(await emitted("inheritance-read-restrictions"), "db/entities.ts");
    expect(e).toContain("export class CarRow extends VehicleRow {");
    expect(e).toContain("new EntitySchema<CarRow, VehicleRow>({");
    expect(e).toContain("extends: VehicleRow,");
    // Car's own column lives on Car's schema, not the root's.
    const carSchema = e.slice(e.indexOf("export const CarRowSchema"));
    expect(carSchema.slice(0, carSchema.indexOf("});"))).toContain("seats:");
    const root = e.slice(e.indexOf("export const VehicleRowSchema"));
    const rootProps = root.slice(root.indexOf("properties: {"), root.indexOf("\n  },"));
    expect(rootProps).not.toContain("seats:");
    // The concretes own no table: only the root names one.
    expect(e.match(/tableName: "vehicles"/g)).toHaveLength(1);
  });

  it("declares every class before the first schema (the map names classes)", async () => {
    const e = file(await emitted("inheritance-read-restrictions"), "db/entities.ts");
    expect(e.indexOf("export class TruckRow")).toBeLessThan(
      e.indexOf("export const VehicleRowSchema"),
    );
  });
});

describe("mikroorm entities — the read scope as named default filters", () => {
  it("hosts the root's and every subtype's restrictions on the root, subtype ones kind-guarded", async () => {
    const e = file(await emitted("inheritance-read-restrictions"), "db/entities.ts");
    const root = e.slice(
      e.indexOf("export const VehicleRowSchema"),
      e.indexOf("export const CarRowSchema"),
    );
    // Capability filters take the capability's name, so `ignoring` can name them.
    expect(root).toContain(
      '"tenantOwned": { name: "tenantOwned", cond: () => ({ tenantId: requireCurrentUser().tenantId }), default: true },',
    );
    expect(root).toContain('"softDeletable": {');
    // Car's own restrictions, guarded by its discriminator.
    expect(root).toContain('{ $or: [{ kind: { $ne: "Car" } }, { isDeleted: false }] }');
    // The bare `filter this.seats > 0` is a filter no `ignoring` can name.
    expect(root).toContain('"loom.filter": {');
    expect(root).toContain('{ $or: [{ kind: { $ne: "Car" } }, { seats: { $gt: 0 } }] }');
  });

  it("joins a concrete's condition only for a query of the root or of that concrete", async () => {
    // `seats` exists only on Car; MikroORM rejects a condition on a property the
    // QUERIED entity lacks, so Truck's queries must not see Car's condition.
    const e = file(await emitted("inheritance-read-restrictions"), "db/entities.ts");
    expect(e).toContain('if (entity === "VehicleRow" || entity === "CarRow") parts.push(');
    expect(e).not.toContain('entity === "TruckRow"');
    expect(e).toContain("args: false,");
  });

  it("declares a TPC concrete's filters on its own schema, unguarded", async () => {
    const e = file(await emitted("inheritance-read-restrictions"), "db/entities.ts");
    const driver = e.slice(
      e.indexOf("export const DriverRowSchema"),
      e.indexOf("export class DispatcherRow"),
    );
    expect(driver).toContain(
      '"softDeletable": { name: "softDeletable", cond: () => ({ isDeleted: false }), default: true },',
    );
    expect(driver).toContain('"tenantOwned":');
    expect(driver).not.toContain("$or");
  });

  it("names no filter on an aggregate with no restriction", async () => {
    const e = file(await emitted("tph"), "db/entities.ts");
    expect(e).not.toContain("filters:");
  });
});

describe("mikroorm repositories — reads state only their own where", () => {
  it("scopes a concrete's reads by its Row class, not by a hand-written kind", async () => {
    const f = await emitted("inheritance-read-restrictions");
    const cars = file(f, "db/repositories/car-repository.ts");
    expect(cars).toContain("em.findOne(CarRow, { id: id as string })");
    expect(cars).toContain("em.find(CarRow, {})");
    expect(cars).not.toMatch(/\{ kind:/);
  });

  it("renders `ignoring X` as a filter switch on the named filter only", async () => {
    const cars = file(
      await emitted("inheritance-read-restrictions"),
      "db/repositories/car-repository.ts",
    );
    expect(cars).toContain('{ filters: { "softDeletable": false } }');
    expect(cars).toContain('{ filters: { "tenantOwned": false } }');
    // The plain find states no switch at all.
    expect(cars).toMatch(
      /async byPlate\([^)]*\)[^{]*\{\n[^\n]*\n\s+const row = await em\.findOne\(CarRow, \{ plate: p \}\);/,
    );
  });

  it("bypasses the read filters on the writes it scopes by id", async () => {
    const f = await emitted("inheritance-read-restrictions");
    const drivers = file(f, "db/repositories/driver-repository.ts");
    // A soft-deleted row is still the row: the existence probe must see it, or
    // the save would INSERT a duplicate key.
    expect(drivers).toContain(
      "em.findOne(DriverRow, { id: aggregate.id as string }, { filters: false })",
    );
    expect(drivers).toContain("{ filters: false });");
    const trucks = file(f, "db/repositories/truck-repository.ts");
    expect(trucks).toContain("nativeDelete(TruckRow, { id: id as string }, { filters: false })");
  });
});

describe("mikroorm polymorphic base reader", () => {
  it("reads the whole TPH hierarchy with ONE root find, ordered by id and paged", async () => {
    const f = await emitted("inheritance-base-reads");
    const reader = file(f, "db/repositories/equipment-repository.ts");
    expect(reader).toContain('em.find(EquipmentRow, {}, { orderBy: { id: "asc" } })');
    expect(reader).toContain("em.count(EquipmentRow, {})");
    expect(reader).toContain("limit: pageSize, offset: (page - 1) * pageSize");
    // It states no restriction of its own: the root schema's filters apply.
    expect(reader).not.toMatch(/\bkind: \{ \$ne|requireCurrentUser|isDeleted/);
    expect(reader).toContain("switch (row.kind)");
    expect(reader).toContain("toWire(root:");
  });

  it("routes the base read (list, and by-id for TPH) on the mikroorm adapter", async () => {
    const f = await emitted("inheritance-base-reads");
    const routes = file(f, "http/equipment.routes.ts");
    expect(routes).toContain("repo.findPage(");
    expect(routes).toContain("repo.findById(");
    expect(file(f, "http/index.ts")).toContain(
      "equipmentRoutes(new EquipmentRepository(db, events))",
    );
  });
});
