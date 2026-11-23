// A field typed on an entity part (`lines: QuoteLine[]`) is the same part on
// the wire as `contains lines: QuoteLine[]`, so the scaffolded detail page
// shows it the same way: on every frontend and on LiveView the two spellings
// generate the same project, byte for byte.
//
// Non-vacuity: the same model without the part field generates a different
// project, so an equality that held only because neither spelling rendered
// the part would fail here.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

type Spelling = "field" | "contains" | "none";

const LINES: Record<Spelling, string> = {
  field: "lines: QuoteLine[]",
  contains: "contains lines: QuoteLine[]",
  none: "",
};

interface Target {
  name: string;
  /** The deployables of the system, around `ui Web`. */
  deployables: string;
  ui: string;
}

const API =
  "deployable api { platform: node  contexts: [Sales]  dataSources: [st]  serves: SalesApi  port: 3000 }";

const web = (framework: string): Target => ({
  name: framework,
  ui: `ui Web with scaffold(subdomains: [Sales]) { framework: ${framework} }`,
  deployables: `${API}\n  deployable web { platform: web  targets: api  ui: Web  port: 3001 }`,
});

const own = (platform: string): Target => ({
  name: platform,
  ui: "ui Web with scaffold(subdomains: [Sales]) { }",
  deployables: `${API}\n  deployable web { platform: ${platform}  targets: api  ui: Web  port: 3001 }`,
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
      "deployable api { platform: elixir  contexts: [Sales]  dataSources: [st]  serves: SalesApi  ui: Web { S: api }  port: 3000 }",
  },
];

function model(t: Target, spelling: Spelling): string {
  return `
system Freight {
  subdomain Sales {
    context Sales {
      enum TransportMode { Air, Sea }
      aggregate Quote {
        reference: string
        ${LINES[spelling]}
        ${spelling === "none" ? "" : "entity QuoteLine { mode: TransportMode  price: money  transitDays: int }"}
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
}

function sameFiles(a: Map<string, string>, b: Map<string, string>): string[] {
  const diffs: string[] = [];
  for (const p of new Set([...a.keys(), ...b.keys()])) if (a.get(p) !== b.get(p)) diffs.push(p);
  return diffs.sort();
}

describe("a field typed on an entity part shows on the detail page as a contained part does", () => {
  it.each(TARGETS.map((t) => [t.name, t] as const))(
    "%s: `lines: QuoteLine[]` and `contains lines: QuoteLine[]` generate the same project",
    async (_name, t) => {
      const field = await generateSystemFiles(model(t, "field"));
      const contains = await generateSystemFiles(model(t, "contains"));
      const none = await generateSystemFiles(model(t, "none"));
      expect(sameFiles(field, contains), `${t.name}: files that differ`).toEqual([]);
      expect(
        sameFiles(contains, none).length,
        `${t.name}: the part reaches the project`,
      ).toBeGreaterThan(0);
    },
    120_000,
  );
});
