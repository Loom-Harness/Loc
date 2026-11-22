// A gateway's `apps { … }` list, as the gateway serves it: the hand-written
// order, the source label, and each label's translations from the catalog.
// Without the block the gateway serves no list, in compose or in a cluster,
// and keeps the whole `/_gateway/` prefix to itself either way.
//
// String tier, on purpose: the booted leg (`test/e2e/gateway-compose-e2e.test.ts`)
// reads the served list and every part's links; what it cannot observe is the
// absence of the list on a gateway without the block, the cluster objects it
// does not boot, and the translated labels (it boots no locale).

import { describe, expect, it } from "vitest";
import { buildMessageCatalog } from "../../src/system/i18n-catalog.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { buildLoomModel } from "../_helpers/ir.js";

const model = (apps: string): string => `
system Gw {
  subdomain Catalog { context Catalog {
    aggregate Product with crudish { sku: string }
  } }
  ui Back with scaffold(subdomains: [Catalog]) { }
  ui Ops with scaffold(subdomains: [Catalog]) { }
  storage primary { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: primary }
  deployable admin { platform: node contexts: [Catalog] dataSources: [catalogState] port: 3000 }
  deployable back { platform: web targets: admin ui: Back port: 3001 }
  deployable ops { platform: web targets: admin ui: Ops port: 3002 }
  deployable site {
    platform: gateway
    port: 8088
    gathers: [ back at "/", ops at "/ops" ]
    ${apps}
  }
}
`;

const LISTED = model(`apps { app ops label "Operations" app back label "Back office" }`);

describe("gateway apps — the served list", () => {
  it("serves the list in its own order, with each app's path", async () => {
    const files = await generateSystemFiles(LISTED);
    expect(JSON.parse(files.get("site/apps.json") ?? "null")).toEqual([
      { path: "/ops/", label: "Operations" },
      { path: "/", label: "Back office" },
    ]);
    expect(files.get("site/nginx.conf")).toContain("location = /_gateway/apps {");
    expect(files.get("site/Dockerfile")).toContain("COPY apps.json");
  });

  it("serves no list without the block, and keeps /_gateway/ to itself", async () => {
    const files = await generateSystemFiles(model(""));
    expect(files.has("site/apps.json")).toBe(false);
    expect(files.get("site/Dockerfile")).not.toContain("apps.json");
    const conf = files.get("site/nginx.conf") ?? "";
    expect(conf).not.toContain("/_gateway/apps");
    expect(conf).toContain("location = /_gateway/health {");
    expect(conf).toContain("location ^~ /_gateway/ {");
  });

  it("runs the gateway's own cluster workload only for a list", async () => {
    const listed = await generateSystemFiles(LISTED, { emitKubernetes: true });
    expect(listed.get("k8s/site-gateway.yaml")).toContain('"label": "Operations"');
    expect(listed.get("k8s/site-ingress.yaml")).toContain("path: /_gateway");
    expect(listed.has("helm/templates/site-gateway.yaml")).toBe(true);
    const bare = await generateSystemFiles(model(""), { emitKubernetes: true });
    expect(bare.has("k8s/site-gateway.yaml")).toBe(false);
    expect(bare.has("helm/templates/site-gateway.yaml")).toBe(false);
    expect(bare.get("k8s/site-ingress.yaml")).not.toContain("path: /_gateway");
  });
});

describe("gateway apps — translatable labels", () => {
  it("catalogs each label under the gateway's name", async () => {
    const sys = (await buildLoomModel(LISTED)).systems[0]!;
    const keys = Object.entries(buildMessageCatalog(sys)).filter(([k]) =>
      k.startsWith("site.apps."),
    );
    expect(keys.map(([k, v]) => [k.split(".").slice(0, 3).join("."), v])).toEqual([
      ["site.apps.back", "Back office"],
      ["site.apps.ops", "Operations"],
    ]);
  });

  it("serves each translated label beside the source one", async () => {
    const sys = (await buildLoomModel(LISTED)).systems[0]!;
    const catalog = buildMessageCatalog(sys);
    const opsKey = Object.keys(catalog).find((k) => k.startsWith("site.apps.ops."))!;
    const files = await generateSystemFiles(LISTED, {
      translations: new Map([["pl", { [opsKey]: "Operacje" }]]),
    });
    expect(JSON.parse(files.get("site/apps.json") ?? "null")).toEqual([
      { path: "/ops/", label: "Operations", labels: { pl: "Operacje" } },
      { path: "/", label: "Back office" },
    ]);
  });
});
