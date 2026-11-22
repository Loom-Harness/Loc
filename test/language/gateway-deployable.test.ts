// The `gateway` platform's `gathers:` clause: it parses, prints back, lowers
// onto `DeployableIR.gathers`, and every `loom.gateway-*` rule fires on its
// defect and stays silent on the well-formed control.

import { EmptyFileSystem } from "langium";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { createDddServices } from "../../src/language/ddd-module.js";
import type { Deployable, Model, System } from "../../src/language/generated/ast.js";
import { printStructural } from "../../src/language/print/print-structural.js";

/** A node backend `api`, a second backend `api2`, two React uis and a Flutter
 *  ui; `deployables` adds the frontends and gateways under test. */
const sys = (deployables: string): string => `
system P {
  subdomain D {
    context Orders {
      aggregate Order with crudish { name: string  at: datetime }
      repository Orders for Order
    }
  }
  api OrdersApi from D
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  ui Back { page Home { route: "/"  body: Stack { Text { "back" } } } }
  ui Ops { framework: vue  page Home { route: "/"  body: Stack { Text { "ops" } } } }
  ui Mob { framework: flutter  page Home { route: "/"  body: Stack { Text { "mob" } } } }
  deployable api { platform: node contexts: [Orders] dataSources: [st] serves: OrdersApi port: 3000 }
  deployable api2 { platform: python contexts: [Orders] dataSources: [st] serves: OrdersApi port: 3009 }
${deployables}
}`;

const PARTS = `
  deployable backoffice { platform: web targets: api ui: Back port: 3001 }
  deployable ops { platform: web targets: api ui: Ops port: 3002 }`;

/** The owner-accepted surface: two web deployables behind one front door. */
const WELL_FORMED = sys(`${PARTS}
  deployable site {
    platform: gateway
    port: 8080
    gathers: [ backoffice at "/", ops at "/ops" ]
  }`);

async function codes(src: string): Promise<string[]> {
  return (await validate(src)).diagnostics
    .filter((d) => d.severity === "error")
    .map((d) => d.code ?? d.message);
}

async function messagesOf(src: string, code: string): Promise<string[]> {
  return (await validate(src)).diagnostics.filter((d) => d.code === code).map((d) => d.message);
}

const gateway = (gathers: string, extra = ""): string =>
  sys(`${PARTS}
  deployable site { platform: gateway port: 8080 ${extra} gathers: [ ${gathers} ] }`);

describe("gateway — the well-formed control", () => {
  it("validates with no error", async () => {
    expect(await codes(WELL_FORMED)).toEqual([]);
  });

  it("lowers `gathers:` onto the deployable in source order", async () => {
    const services = createDddServices(EmptyFileSystem).Ddd;
    const doc = await parseHelper<Model>(services)(WELL_FORMED);
    const site = lowerModel(doc.parseResult.value).systems[0]?.deployables.find(
      (d) => d.name === "site",
    );
    expect(site?.platform).toBe("gateway");
    expect(site?.gathers).toEqual([
      { deployable: "backoffice", path: "/" },
      { deployable: "ops", path: "/ops" },
    ]);
    // A deployable that declares no `gathers:` carries none.
    const api = lowerModel(doc.parseResult.value).systems[0]?.deployables.find(
      (d) => d.name === "api",
    );
    expect(api && "gathers" in api).toBe(false);
  });

  it("prints back to source that reparses to the same clause", async () => {
    const services = createDddServices(EmptyFileSystem).Ddd;
    const parse = parseHelper<Model>(services);
    const doc = await parse(WELL_FORMED);
    const site = (doc.parseResult.value.members[0] as System).members.find(
      (m): m is Deployable => m.$type === "Deployable" && m.name === "site",
    );
    const printed = printStructural(site as Deployable);
    expect(printed).toContain(`gathers: [backoffice at "/", ops at "/ops"]`);
    const again = await parse(sys(`${PARTS}\n${printed}`));
    expect(again.parseResult.parserErrors).toEqual([]);
  });

  it("keeps `at` an ordinary field name", async () => {
    // The fixture's `Order.at` field: `at` is a soft keyword.
    expect(await codes(WELL_FORMED)).not.toContain("loom.parse-error");
  });
});

describe("gateway — the clause's shape (AST)", () => {
  it("loom.gateway-gathers-misplaced: `gathers:` on a backend", async () => {
    const src = sys(`${PARTS}
  deployable api3 { platform: node contexts: [Orders] dataSources: [st] port: 3010 gathers: [ backoffice at "/" ] }`);
    expect(await codes(src)).toContain("loom.gateway-gathers-misplaced");
    expect(await codes(WELL_FORMED)).not.toContain("loom.gateway-gathers-misplaced");
  });

  it("loom.gateway-gathers-missing: a gateway that gathers nothing", async () => {
    const src = sys(`${PARTS}\n  deployable site { platform: gateway port: 8080 }`);
    expect(await codes(src)).toEqual(["loom.gateway-gathers-missing"]);
  });

  it.each([
    ["contexts", "contexts: [Orders]"],
    ["dataSources", "dataSources: [st]"],
    ["serves", "serves: OrdersApi"],
    ["ui", "ui: Back"],
    ["hosts", "hosts: [Back]"],
  ])("loom.gateway-clause-invalid: a gateway that declares `%s:`", async (clause, text) => {
    const src = gateway(`backoffice at "/"`, text);
    // A clause can carry its own consequences too (a `serves:` api whose
    // contexts nothing hosts); the gateway rule is the one that names it.
    expect(await codes(src)).toContain("loom.gateway-clause-invalid");
    expect((await messagesOf(src, "loom.gateway-clause-invalid"))[0]).toContain(`'${clause}:'`);
  });

  it.each([
    ["ops", "does not start with '/'"],
    ["/ops/", "ends in '/'"],
    ["/a b", "segment 'a b'"],
    ["/../x", "segment '..'"],
    ["/a//b", "segment ''"],
    ["/a?b", "segment 'a?b'"],
    ["/api", "under '/api'"],
    ["/api/admin", "under '/api'"],
    ["/_gateway", "under '/_gateway'"],
  ])("loom.gateway-path-invalid: %s", async (path, says) => {
    const src = gateway(`backoffice at "/", ops at ${JSON.stringify(path)}`);
    expect(await codes(src)).toEqual(["loom.gateway-path-invalid"]);
    expect((await messagesOf(src, "loom.gateway-path-invalid"))[0]).toContain(says);
  });

  it("accepts the root, nested paths and a prefix of another part's path", async () => {
    expect(await codes(gateway(`backoffice at "/", ops at "/ops/v2.1_x-y~z"`))).toEqual([]);
    expect(await codes(gateway(`backoffice at "/ops", ops at "/ops/admin"`))).toEqual([]);
    expect(await codes(gateway(`backoffice at "/", ops at "/apis"`))).toEqual([]);
  });

  it("loom.gateway-path-duplicate: two parts at one path", async () => {
    expect(await codes(gateway(`backoffice at "/ops", ops at "/ops"`))).toEqual([
      "loom.gateway-path-duplicate",
    ]);
  });

  it("loom.gateway-part-duplicate: one part listed twice", async () => {
    expect(await codes(gateway(`backoffice at "/", backoffice at "/b"`))).toEqual([
      "loom.gateway-part-duplicate",
    ]);
  });
});

describe("gateway — the gathered deployables (IR)", () => {
  it("loom.gateway-part-not-web: a backend part", async () => {
    const src = gateway(`backoffice at "/", api at "/x"`);
    expect(await codes(src)).toEqual(["loom.gateway-part-not-web"]);
    // The message lists the frontends a gateway can serve: every one.
    const message = (await messagesOf(src, "loom.gateway-part-not-web"))[0];
    for (const fw of ["web", "feliz", "flutter"]) expect(message).toContain(`'${fw}'`);
  });

  it("loom.gateway-part-not-web: a gateway gathering a gateway", async () => {
    const src = sys(`${PARTS}
  deployable site { platform: gateway port: 8080 gathers: [ backoffice at "/" ] }
  deployable outer { platform: gateway port: 8081 gathers: [ site at "/" ] }`);
    expect(await codes(src)).toEqual(["loom.gateway-part-not-web"]);
  });

  it("a Feliz or Flutter part sits under a base path, or at the root", async () => {
    const src = sys(`${PARTS}
  ui Fz { framework: feliz  page Home { route: "/"  body: Stack { Text { "fz" } } } }
  deployable fz { platform: feliz targets: api ui: Fz port: 3003 }
  deployable mob { platform: flutter targets: api ui: Mob port: 3004 }
  deployable site { platform: gateway port: 8080 gathers: [ backoffice at "/", fz at "/fz", mob at "/m" ] }
  deployable site2 { platform: gateway port: 8081 gathers: [ ops at "/ops" ] }`);
    expect(await codes(src)).toEqual([]);
  });

  it("loom.gateway-targets-mixed: parts that target different backends", async () => {
    const src = sys(`
  deployable backoffice { platform: web targets: api ui: Back port: 3001 }
  deployable ops { platform: web targets: api2 ui: Ops port: 3002 }
  deployable site { platform: gateway port: 8080 gathers: [ backoffice at "/", ops at "/ops" ] }`);
    expect(await codes(src)).toEqual(["loom.gateway-targets-mixed"]);
  });

  it("an untargeted part is the frontend's own `loom.frontend-targets-missing`", async () => {
    const src = sys(`
  deployable backoffice { platform: web ui: Back port: 3001 }
  deployable site { platform: gateway port: 8080 gathers: [ backoffice at "/" ] }`);
    expect(await codes(src)).toEqual(["loom.frontend-targets-missing"]);
  });

  it("loom.gateway-part-shared: one part behind two gateways", async () => {
    const src = sys(`${PARTS}
  deployable site { platform: gateway port: 8080 gathers: [ backoffice at "/", ops at "/ops" ] }
  deployable site2 { platform: gateway port: 8081 gathers: [ backoffice at "/" ] }`);
    expect(await codes(src)).toEqual(["loom.gateway-part-shared"]);
  });

  it("two gateways over different parts are fine", async () => {
    const src = sys(`${PARTS}
  deployable site { platform: gateway port: 8080 gathers: [ backoffice at "/" ] }
  deployable site2 { platform: gateway port: 8081 gathers: [ ops at "/" ] }`);
    expect(await codes(src)).toEqual([]);
  });
});
