// TPH READ paths on python/SQLAlchemy: the bulk id load must carry the `kind`
// discriminator (a Car row was hydrated as a Truck), and the polymorphic base
// reader must skip rows a concrete's read filters exclude instead of raising.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYSTEM = (body: string): string => `
system PyFleet {
  subdomain D {
    context Fleet {
      ${body}
    }
  }
  api A from D
  storage primary { type: postgres }
  resource st { for: Fleet, kind: state, use: primary }
  deployable api {
    platform: python
    contexts: [Fleet]
    dataSources: [st]
    serves: A
    port: 8000
  }
}`;

const TPH = SYSTEM(`
      abstract aggregate Vehicle inheritanceUsing: sharedTable {
        name: string
      }
      aggregate Car extends Vehicle with crudish {
        doors: int
      }
      aggregate Truck extends Vehicle with crudish {
        payloadKg: int
      }
      repository Cars for Car { }
      repository Trucks for Truck { }`);

const build = (src: string): Promise<Map<string, string>> => generateSystemFiles(src);

describe("python TPH read paths", () => {
  it("find_many_by_ids scopes by kind as well as id", async () => {
    const files = await build(TPH);
    const car = files.get("api/app/db/repositories/car_repository.py") ?? "";
    const truck = files.get("api/app/db/repositories/truck_repository.py") ?? "";
    const bulk = (src: string): string =>
      src.split("\n").find((l) => l.includes("VehicleRow.id.in_(list(ids))")) ?? "";
    expect(bulk(car), "find_many_by_ids emitted").not.toEqual("");
    expect(bulk(car)).toContain('VehicleRow.kind == "Car"');
    expect(bulk(truck)).toContain('VehicleRow.kind == "Truck"');
  });

  it("the base reader skips filtered rows rather than raising", async () => {
    const files = await build(TPH);
    const reader = files.get("api/app/db/repositories/vehicle_repository.py") ?? "";
    expect(reader, "base reader emitted").not.toEqual("");
    // Dispatches through the concrete `find_by_id` (None when its filters
    // exclude the row); `get_by_id` raises AggregateNotFoundError.
    expect(reader).toContain(".find_by_id(");
    expect(reader).not.toContain(".get_by_id(");
    expect(reader).toContain("if item is not None");
  });
});
