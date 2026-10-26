import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// The abstract base's polymorphic reader (`GET /api/<bases>`) on the plain
// Ecto/Phoenix backend (base-reader.ts), per the cross-backend contract of
// #3959: one paged read over the hierarchy in the global `id` order, each row
// its concrete, tagged `type` on the wire.
//
//   - TPH reads the shared table ONCE, from the root's `base_query/0`; the
//     root's schema hosts every concrete's restrictions kind-guarded, and
//     `Repo.prepare_query/3` applies them, so the reader spells none.
//   - TPC merges each concrete's scoped read (its own `base_query/0`); a
//     `shape: document` concrete's in-app filtered repository stands in.
// ---------------------------------------------------------------------------

const SYS = (body: string): string => `
system Fleet {
  user { id: guid  tenantId: string }
  tenancy by user.tenantId of Org
  subdomain D {
    context Fleet {
      ${body}
    }
    context Registry {
      aggregate Org with crudish {
        name: string
        implements tenantRegistry
      }
      repository Orgs for Org { }
    }
  }
  api A from D
  storage primary { type: postgres }
  resource st { for: Fleet, kind: state, use: primary }
  resource rt { for: Registry, kind: state, use: primary }
  deployable api {
    platform: elixir
    auth: required
    contexts: [Fleet, Registry]
    dataSources: [st, rt]
    serves: A
    port: 4000
  }
}`;

const TPH = SYS(`
      abstract aggregate Vehicle inheritanceUsing: sharedTable { name: string }
      aggregate Car extends Vehicle with crudish, tenantOwned, softDeletable { seats: int }
      aggregate Truck extends Vehicle with crudish, tenantOwned, softDeletable { payloadKg: int }
      repository Cars for Car {
        find all(): Car paged
      }
      repository Trucks for Truck { }
`);

const TPC = SYS(`
      abstract aggregate Asset inheritanceUsing: ownTable { label: string }
      aggregate Machine extends Asset with crudish, tenantOwned { serial: string }
      aggregate Rig extends Asset shape: document, with crudish, tenantOwned { tag: string }
      repository Machines for Machine { }
      repository Rigs for Rig { }
`);

const TPH_RETRIEVAL = SYS(`
      abstract aggregate Vehicle inheritanceUsing: sharedTable { name: string }
      aggregate Car extends Vehicle with crudish, tenantOwned { seats: int }
      aggregate Truck extends Vehicle with crudish, tenantOwned { payloadKg: int }
      repository Cars for Car { }
      repository Trucks for Truck { }
      retrieval BigCars(min: int) of Car { where: seats >= min }
`);

function file(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  if (!key) throw new Error(`no generated file ending ${suffix}`);
  return files.get(key)!;
}

describe("elixir/vanilla — abstract base reader applies the concretes' read restrictions", () => {
  it("TPH: one query over the root's base_query/0, paged in id order, loaded per kind", async () => {
    const files = await generateSystemFiles(TPH);
    const repo = file(files, "/fleet/vehicle_repository.ex");
    expect(repo).toContain('@kinds %{"Car" => Api.Fleet.Car, "Truck" => Api.Fleet.Truck}');
    expect(repo).toContain(
      "query = from(record in Api.Fleet.Vehicle.base_query(), where: record.kind in ^Map.keys(@kinds))",
    );
    expect(repo).toContain("Repo.aggregate(query, :count, current_user: current_user)");
    expect(repo).toContain("|> order_by([record], asc: record.id)");
    expect(repo).toContain("|> Enum.map(&as_concrete/1)");
    // Never a concrete repository, and never a spelled restriction.
    expect(repo).not.toContain("CarRepository");
    expect(repo).not.toMatch(/tenant_id|is_deleted/);
    // The root's schema hosts each concrete's own restrictions, kind-guarded.
    const root = file(files, "/fleet/vehicle.ex");
    expect(root).toContain('record.kind != "Car" or (not record.is_deleted)');
    expect(root).toContain('record.kind != "Truck" or (not record.is_deleted)');
  });

  it("TPH: the façade, the controller and the router agree with the reader", async () => {
    const files = await generateSystemFiles(TPH);
    const facade = file(files, "/api/fleet.ex");
    expect(facade).toContain(
      "defdelegate list_vehicles(page \\\\ 1, page_size \\\\ 20, current_user \\\\ nil), to: Api.Fleet.VehicleRepository, as: :list",
    );
    expect(facade).toContain(
      "defdelegate get_vehicle(id, current_user \\\\ nil), to: Api.Fleet.VehicleRepository, as: :find_by_id",
    );
    const ctl = file(files, "/controllers/vehicle_controller.ex");
    expect(ctl).toContain("Fleet.list_vehicles(page_arg, page_size_arg, current_user)");
    expect(ctl).toContain("Fleet.get_vehicle(id, current_user)");
    // Each row is its concrete's wire body, tagged.
    expect(ctl).toContain(
      'defp serialize(%Api.Fleet.Car{} = record),\n    do: Map.put(serialize_car(record), "type", "Car")',
    );
    const router = file(files, "/api_web/router.ex");
    expect(router).toContain('get "/vehicles", VehicleController, :index');
    expect(router).toContain('get "/vehicles/:id", VehicleController, :show');
  });

  it("TPC: merges the concretes' scoped reads; a document concrete's repository stands in", async () => {
    const files = await generateSystemFiles(TPC);
    const repo = file(files, "/fleet/asset_repository.ex");
    expect(repo).toContain("query = Api.Fleet.Machine.base_query()");
    expect(repo).toContain("{:ok, rows} = Api.Fleet.RigRepository.list(current_user)");
    expect(repo).toContain("|> Enum.sort_by(& &1.id)");
    const ctl = file(files, "/controllers/asset_controller.ex");
    expect(ctl).toContain(
      'defp serialize(%Api.Fleet.Rig{} = record),\n    do: Map.put(serialize_rig(record), "type", "Rig")',
    );
    expect(ctl).toContain("record = row.data");
    // TPC ids are per concrete: the list is routed, a by-id read is not.
    const router = file(files, "/api_web/router.ex");
    expect(router).toContain('get "/assets", AssetController, :index');
    expect(router).not.toContain('get "/assets/:id"');
  });

  it("does not route the base read past a concrete's list gate", async () => {
    const gated = TPH.replace(
      "repository Trucks for Truck { }",
      'repository Trucks for Truck { }\n      policy { read Truck requires currentUser.tenantId == "root" }',
    );
    const router = file(await generateSystemFiles(gated), "/api_web/router.ex");
    expect(router).not.toContain('get "/vehicles"');
  });

  it("a retrieval over a TPH concrete carries the kind conjunct", async () => {
    const files = await generateSystemFiles(TPH_RETRIEVAL);
    const ret = file(files, "/retrievals/big_cars.ex");
    // The retrieval starts from the concrete's `base_query/0`, which carries the
    // `kind` discriminator.
    expect(ret).toMatch(/from\(record in \S+\.Car\.base_query\(\), where:/);
    expect(file(files, "/car.ex")).toContain('where: record.kind == "Car"');
  });
});
