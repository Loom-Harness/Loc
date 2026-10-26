// TPH READ paths on python/SQLAlchemy: every read of a concrete names its
// mapped subclass, whose `polymorphic_identity` makes SQLAlchemy add the
// `kind` discriminator (a Car row was once hydrated as a Truck through the bulk
// id load), and the polymorphic base reader is one select over the root that
// hydrates each row as the subclass its `kind` names.

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
  it("find_many_by_ids reads the concrete's mapped subclass", async () => {
    const files = await build(TPH);
    const car = files.get("api/app/db/repositories/car_repository.py") ?? "";
    const truck = files.get("api/app/db/repositories/truck_repository.py") ?? "";
    expect(car).toContain("select(CarRow).where(CarRow.id.in_(list(ids)))");
    expect(truck).toContain("select(TruckRow).where(TruckRow.id.in_(list(ids)))");
    const schema = files.get("api/app/db/schema.py") ?? "";
    expect(schema).toContain(
      'class CarRow(VehicleRow):\n    __mapper_args__ = {"polymorphic_identity": "Car"}',
    );
  });

  it("the base reader hydrates each polymorphic row through its concrete repository", async () => {
    const files = await build(TPH);
    const reader = files.get("api/app/db/repositories/vehicle_repository.py") ?? "";
    expect(reader, "base reader emitted").not.toEqual("");
    expect(reader).toContain(
      "select(VehicleRow).where(VehicleRow.id == id).execution_options(populate_existing=True)",
    );
    expect(reader).toContain(
      "if isinstance(row, CarRow):\n            return await CarRepository(self._session, self._events)._hydrate(row)",
    );
    expect(reader).not.toContain(".get_by_id(");
  });
});
