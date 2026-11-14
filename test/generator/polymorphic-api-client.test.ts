// The typed in-system api clients reach an abstract base's polymorphic reads.
//
// The callee serves `GET /api/<bases>` (and, under TPH, `GET /api/<bases>/{id}`)
// answering TAGGED rows — `{ "type": "Car", …Car's read wire fields }`.  Each
// backend's client takes its operation set from `contextOperations` and its row
// shape from the routed read's variants, so every caller gets one function per
// base read and parses the row as its language's union discriminated on `type`.
//
// Tier: this is WIRING no booted tier observes — no corpus fixture calls a base
// read through an in-system client (a `.ddd` workflow cannot name one), so the
// emitted client text is the only place the binding shows.  The compile tier
// over each caller project is what proves the emitted types are well-formed.

import { describe, expect, it } from "vitest";
import { snake, upperFirst } from "../../src/util/naming.js";
import { generateSystemFiles } from "../_helpers/generate.js";

const source = (caller: string): string => `
system Poly {
  subdomain D {
    context Fleet {
      abstract aggregate Vehicle inheritanceUsing: sharedTable { plate: string }
      aggregate Car extends Vehicle with crudish { seats: int }
      aggregate Truck extends Vehicle with crudish { payloadKg: int = 0 }
      repository Cars for Car { }
      repository Trucks for Truck { }

      abstract aggregate Crew inheritanceUsing: ownTable { name: string }
      aggregate Driver extends Crew inheritanceUsing: ownTable with crudish { licence: string }
      aggregate Dispatcher extends Crew inheritanceUsing: ownTable with crudish { desk: int = 0 }
      repository Drivers for Driver { }
      repository Dispatchers for Dispatcher { }
    }
    context Yard {
      aggregate Slot with crudish { label: string }
      repository Slots for Slot { }
    }
  }
  api FleetApi from D
  storage pg { type: postgres }
  resource fleetState { for: Fleet, kind: state, use: pg }
  resource yardState  { for: Yard,  kind: state, use: pg }
  resource fleet      { for: Yard,  kind: api,   use: FleetApi }
  deployable fleetSvc {
    platform: node contexts: [Fleet] dataSources: [fleetState] serves: FleetApi port: 4000
  }
  deployable yardSvc {
    platform: ${caller} contexts: [Yard] dataSources: [yardState, fleet] port: 4001
  }
}
`;

interface ClientCase {
  readonly platform: string;
  readonly path: string;
  /** The client function's declaration for an operation id. */
  readonly fn: (opId: string) => string;
  /** One line per base that only its tagged-row rendering emits. */
  readonly rows: readonly string[];
}

const CASES: readonly ClientCase[] = [
  {
    platform: "node",
    path: "yard_svc/resources/api-clients.ts",
    fn: (id) => `export async function fleet$${id}(`,
    rows: [
      `export const VehicleResponse = z.discriminatedUnion("type", [CarResponse.extend({ type: z.literal("Car") }), TruckResponse.extend({ type: z.literal("Truck") })]);`,
      `export const CrewResponse = z.discriminatedUnion("type", [DriverResponse.extend({ type: z.literal("Driver") }), DispatcherResponse.extend({ type: z.literal("Dispatcher") })]);`,
    ],
  },
  {
    platform: "python",
    path: "yard_svc/app/resources/api_clients.py",
    fn: (id) => `async def fleet_${snake(id)}(`,
    rows: [
      `VehicleResponse = Annotated[VehicleCarItem | VehicleTruckItem, Field(discriminator="type")]`,
      `CrewResponse = Annotated[CrewDriverItem | CrewDispatcherItem, Field(discriminator="type")]`,
    ],
  },
  {
    platform: "dotnet",
    path: "yard_svc/Resources/ApiClients.cs",
    fn: (id) => ` Fleet_${upperFirst(id)}(`,
    rows: [
      `[JsonDerivedType(typeof(VehicleResponse.Truck), "Truck")]`,
      `[JsonDerivedType(typeof(CrewResponse.Dispatcher), "Dispatcher")]`,
    ],
  },
  {
    platform: "java",
    path: "yard_svc/src/main/java/com/loom/yardsvc/resources/ApiClients.java",
    fn: (id) => ` fleet${upperFirst(id)}(`,
    rows: [
      "public sealed interface VehicleResponse permits VehicleResponse.Car, VehicleResponse.Truck {",
      "public sealed interface CrewResponse permits CrewResponse.Driver, CrewResponse.Dispatcher {",
    ],
  },
  {
    platform: "elixir",
    path: "yard_svc/lib/yard_svc/resources/api_clients.ex",
    fn: (id) => `def fleet_${snake(id)}(`,
    rows: [
      `raise ArgumentError, "unexpected Vehicle row type: #{inspect(other)}"`,
      `raise ArgumentError, "unexpected Crew row type: #{inspect(other)}"`,
    ],
  },
];

describe.each(CASES)("$platform typed api client — polymorphic base reads", (c) => {
  it("emits a function per routed base read and parses its row as the tagged union", async () => {
    const files = await generateSystemFiles(source(c.platform));
    const src = files.get(c.path);
    expect(src, `no client module at ${c.path}`).toBeDefined();
    // TPH serves the list and the by-id read; TPC the list only.
    for (const id of ["getVehicleById", "allVehicle", "allCrew"]) {
      expect(src).toContain(c.fn(id));
    }
    expect(src).not.toContain(c.fn("getCrewById"));
    for (const row of c.rows) expect(src).toContain(row);
  });
});
