// A client-side gate reads `currentUser.isSystem` as `false` on every target: a
// browser user is never the system principal (D-REACTOR-SYSTEM-PRINCIPAL), so
// the session user has no such claim.  The rule is `gateReadsSystemPrincipal`
// (`src/generator/_frontend/gate-expr.ts`); the JS gate renderer, the Feliz and
// Flutter gate spellings and the LiveView expression renderer each ask it.  A
// target that read the claim as a field broke: Feliz's `CurrentUser` record and
// Flutter's `CurrentUser` class have no `IsSystem` / `isSystem` (a compile
// error), and LiveView's session map has no `:is_system` (a `KeyError` that
// crashed the page).
//
// An absence claim (no generated page reads the claim), so it is a string
// check; a compile of every frontend is the slow-tier witness.  Non-vacuity:
// the gated operation reaches each UI project.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

interface Target {
  name: string;
  ui: string;
  deployables: string;
  /** The ui project's path prefix in the generated tree. */
  prefix: string;
}

const API =
  "deployable api { platform: node  contexts: [Sales]  dataSources: [st]  serves: SalesApi  port: 3000  auth: required }";

const web = (framework: string): Target => ({
  name: framework,
  ui: `ui Web with scaffold(subdomains: [Sales]) { framework: ${framework} }`,
  deployables: `${API}\n  deployable web { platform: web  targets: api  ui: Web  port: 3001  auth: ui }`,
  prefix: "web/",
});

const own = (platform: string): Target => ({
  name: platform,
  ui: "ui Web with scaffold(subdomains: [Sales]) { }",
  deployables: `${API}\n  deployable web { platform: ${platform}  targets: api  ui: Web  port: 3001  auth: ui }`,
  prefix: "web/",
});

const TARGETS: Target[] = [
  web("react"),
  web("vue"),
  web("svelte"),
  web("angular"),
  own("feliz"),
  own("flutter"),
  {
    name: "phoenixLiveView",
    ui: "ui Web with scaffold(subdomains: [Sales]) { api S: SalesApi }",
    deployables:
      "deployable api { platform: elixir  contexts: [Sales]  dataSources: [st]  serves: SalesApi  ui: Web { S: api }  port: 3000  auth: required }",
    prefix: "api/lib/api_web/live/",
  },
];

const model = (t: Target) => `
system Freight {
  user { id: string  role: string }
  subdomain Sales {
    context Sales {
      aggregate Quote with crudish {
        status: string
        operation expire() requires currentUser.isSystem { status := "Expired" }
      }
      repository Quotes for Quote { }
    }
  }
  api SalesApi from Sales
  ${t.ui}
  storage primary { type: postgres }
  resource st { for: Sales, kind: state, use: primary }
  ${t.deployables}
}
`;

/** A read of the system-principal claim in any of the targets' spellings. */
const READS_CLAIM = /\b(?:isSystem|IsSystem|is_system)\b/;

describe("a client gate reads `currentUser.isSystem` as false on every target", () => {
  it.each(TARGETS.map((t) => [t.name, t] as const))(
    "%s: no generated ui file reads the system-principal claim",
    async (_name, t) => {
      const files = await generateSystemFiles(model(t));
      const ui = [...files].filter(([p]) => p.startsWith(t.prefix));
      const reads = ui.filter(([, src]) => READS_CLAIM.test(src)).map(([p]) => p);
      expect(reads, `${t.name}: ui files reading the claim`).toEqual([]);
      const reachesOp = ui.filter(([, src]) => /expire/i.test(src)).map(([p]) => p);
      expect(reachesOp.length, `${t.name}: the gated operation reaches the ui`).toBeGreaterThan(0);
    },
    120_000,
  );
});
