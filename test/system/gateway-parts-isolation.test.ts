// A gateway's list of apps belongs to the gateway (owner ruling 380): adding a
// part to `gathers:` and to `apps { … }` regenerates the gateway and the new
// part, and leaves every other part's generated project byte-identical.  A ui
// never names another, so a part's `Apps {}` reads the list at run time
// (`/_gateway/apps`) instead of carrying it.
//
// What this holds: the output of every part that was already gathered, file by
// file, across a model with five parts and the same model with a sixth.  The
// gateway's own project (`site/`), its compose/chart wiring and the system
// documents do change, and are not compared.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

/** A page in each ui that renders the gateway's apps. */
const LAUNCHER = `page Launcher { route: "/launch" title: "Apps" body: Stack { Apps {} } }`;

const model = (extraPart: boolean): string => `
system Gw {
  subdomain Catalog { context Catalog {
    aggregate Product with crudish { sku: string }
  } }
  ui Back with scaffold(subdomains: [Catalog]) { ${LAUNCHER} }
  ui Shop with scaffold(subdomains: [Catalog]) { framework: vue ${LAUNCHER} }
  ui Kiosk with scaffold(subdomains: [Catalog]) { framework: svelte ${LAUNCHER} }
  ui Ops with scaffold(subdomains: [Catalog]) { framework: angular ${LAUNCHER} }
  ui Fz with scaffold(subdomains: [Catalog]) { framework: feliz ${LAUNCHER} }
  ui Mob with scaffold(subdomains: [Catalog]) { framework: flutter ${LAUNCHER} }
  storage primary { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: primary }
  deployable admin { platform: node contexts: [Catalog] dataSources: [catalogState] port: 3000 }
  deployable back { platform: web targets: admin ui: Back port: 3001 }
  deployable shop { platform: web targets: admin ui: Shop port: 3002 }
  deployable kiosk { platform: web targets: admin ui: Kiosk port: 3003 }
  deployable ops { platform: web targets: admin ui: Ops port: 3004 }
  deployable fz { platform: feliz targets: admin ui: Fz port: 3005 }
  deployable mob { platform: flutter targets: admin ui: Mob port: 3006 }
  deployable site {
    platform: gateway
    port: 8088
    gathers: [ back at "/", shop at "/shop", kiosk at "/kiosk", fz at "/fz", mob at "/mob"${
      extraPart ? `, ops at "/ops"` : ""
    } ]
    apps {
      app back label "Back office"
      app shop label "Shop"
      app kiosk label "Kiosk"
      app fz label "Feliz"
      app mob label "Mobile"
      ${extraPart ? `app ops label "Operations"` : ""}
    }
  }
}
`;

/** The parts gathered in both models: one per frontend family. */
const STABLE_PARTS = ["back", "shop", "kiosk", "fz", "mob"];

/** Each part's own `Apps` component: present, so the comparison covers it. */
const APPS_FILES = [
  "back/src/lib/apps.tsx",
  "shop/src/components/Apps.vue",
  "kiosk/src/lib/components/Apps.svelte",
  "fz/src/App.fs",
  "mob/lib/apps.dart",
];

describe("gateway parts — adding a part regenerates only the gateway", () => {
  it("leaves every already-gathered part's project byte-identical", async () => {
    const before = await generateSystemFiles(model(false));
    const after = await generateSystemFiles(model(true));
    for (const file of APPS_FILES) expect(before.has(file), file).toBe(true);
    const under = (files: Map<string, string>, part: string) =>
      new Map([...files].filter(([p]) => p.startsWith(`${part}/`)));
    for (const part of STABLE_PARTS) {
      const a = under(before, part);
      const b = under(after, part);
      expect(a.size, part).toBeGreaterThan(0);
      expect([...b.keys()].sort(), part).toEqual([...a.keys()].sort());
      const changed = [...a].filter(([p, c]) => b.get(p) !== c).map(([p]) => p);
      expect(changed, part).toEqual([]);
    }
    // The gateway did change: its list now carries the new part.
    expect(after.get("site/apps.json")).not.toEqual(before.get("site/apps.json"));
    expect(after.get("site/apps.json")).toContain('"/ops/"');
  });
});
