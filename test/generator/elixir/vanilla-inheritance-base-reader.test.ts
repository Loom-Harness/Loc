import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// The abstract base's polymorphic reader (`GET /api/<bases>`) on the plain
// Ecto/Phoenix backend must apply every read restriction of the concretes it
// fronts.  It used to read the TPH shared table directly (`Repo.all(Vehicle)`),
// which carries no `kind` scoping and none of the concretes' capability filters
// (tenancy, soft-delete) or inline predicates — soft-deleted and other tenants'
// rows were served.  It also called the façade with an arity the façade did not
// define, crashed on a paged concrete's envelope, and (TPC) read `record.name`
// off a `shape: document` concrete's `%{data: …}` row.
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
  it("TPH: delegates to each concrete repository, threading the actor and draining a paged concrete", async () => {
    const repo = file(await generateSystemFiles(TPH), "/fleet/vehicle_repository.ex");
    // Never the shared table — that read carries no kind / tenant / soft-delete.
    expect(repo).not.toContain("Repo.all(");
    expect(repo).not.toContain("Repo.get(");
    expect(repo).toContain("def list(current_user \\\\ nil) do");
    expect(repo).toContain("def find_by_id(id, current_user \\\\ nil) when is_binary(id) do");
    // The paged concrete is read page by page with the actor; the other plainly.
    expect(repo).toContain('Api.Fleet.CarRepository.list(page, 500, "id", "asc", current_user)');
    expect(repo).toContain("Api.Fleet.TruckRepository.list(current_user)");
    expect(repo).toContain("Api.Fleet.CarRepository.find_by_id(id, current_user)");
    expect(repo).toContain("Api.Fleet.TruckRepository.find_by_id(id, current_user)");
    // The envelope is unwrapped, not concatenated as if it were a list.
    expect(repo).toContain("{:ok, %{items: items, totalPages: total_pages}}");
  });

  it("TPH: the façade and the controller agree with the reader's arity", async () => {
    const files = await generateSystemFiles(TPH);
    const facade = file(files, "/api/fleet.ex");
    expect(facade).toContain(
      "defdelegate list_vehicles(current_user \\\\ nil), to: Api.Fleet.VehicleRepository, as: :list",
    );
    expect(facade).toContain(
      "defdelegate get_vehicle(id, current_user \\\\ nil), to: Api.Fleet.VehicleRepository, as: :find_by_id",
    );
    const ctl = file(files, "/controllers/vehicle_controller.ex");
    expect(ctl).toContain("Fleet.list_vehicles(current_user)");
    expect(ctl).toContain("Fleet.get_vehicle(id, current_user)");
  });

  it("TPC: the same delegation, and a document concrete is flattened before serializing", async () => {
    const files = await generateSystemFiles(TPC);
    const repo = file(files, "/fleet/asset_repository.ex");
    expect(repo).toContain("Api.Fleet.MachineRepository.list(current_user)");
    expect(repo).toContain("Api.Fleet.RigRepository.list(current_user)");
    const ctl = file(files, "/controllers/asset_controller.ex");
    expect(ctl).toContain("defp serialize(%Api.Fleet.Rig{} = row)");
    expect(ctl).toContain("Map.from_struct(row.data)");
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
