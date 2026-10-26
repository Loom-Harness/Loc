// ---------------------------------------------------------------------------
// The capability table's completeness gate.
//
// `src/util/target-capabilities.ts` gives every target a verdict per construct
// × position, and there is no third state.  This file holds each verdict to
// account on a WITNESS — a minimal model that uses the construct on that
// target:
//
//   supported — the witness validates clean and `generate system` renders it
//               with no `loom:unrendered` give-up (and no throw).
//   refused   — the witness draws `loom.target-unsupported` with the row's own
//               `loom.target-unsupported#<slug>` message.
//   owned     — the witness draws the owning check's code.
//
// So a row cannot claim "supported" for a target that degrades it, and a
// refusal cannot exist without the diagnostic that raises it.  Two more legs
// keep the check itself honest: every detector finds its witness (refuse every
// cell and each construct must fire), and every `#<slug>` message in the
// catalog is used by some row.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_MESSAGES } from "../../src/diagnostics/messages.js";
import { GIVE_UP_SENTINEL } from "../../src/generator/_walker/give-up.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import {
  BACKEND_DETECTORS,
  UI_DETECTORS,
  validateTargetCapabilities,
} from "../../src/ir/validate/checks/target-capability-checks.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import {
  BACKEND_CONSTRUCTS,
  type BackendConstruct,
  type CapabilityVerdict,
  TARGET_CAPABILITIES,
  UI_CONSTRUCT_REFUSAL,
  UI_CONSTRUCTS,
  type UiConstruct,
} from "../../src/util/target-capabilities.js";
import { generateSystemFiles, parseValid } from "../_helpers/index.js";

// --- witnesses ---------------------------------------------------------------

/** The deployables a ui framework implies: a JS frontend is its own bundle
 *  deployable over a node backend; Feliz and Flutter self-host; a
 *  phoenixLiveView ui is served BY its elixir backend. */
function uiTopology(framework: string, uiName: string): string {
  if (framework === "phoenixLiveView") {
    return `deployable app { platform: elixir, contexts: [Orders], dataSources: [st], serves: SalesApi, ui: ${uiName} { Sales: app }, port: 4000 }`;
  }
  const host = framework === "feliz" || framework === "flutter" ? framework : "static";
  return `deployable api { platform: node, contexts: [Orders], dataSources: [st], serves: SalesApi, port: 3000 }
  deployable web { platform: ${host}, targets: api, port: 3001, ui: ${uiName} { Sales: api } }`;
}

/** A system whose one ui page body is `body`, rendered by `framework`. */
const uiWitness = (framework: string, body: string, contextExtra = "", aggMods = ""): string => `
system W {
  subdomain Sales {
    context Orders {
      enum Tier { Basic Gold }
      aggregate Customer ${aggMods}{ name: string  tier: Tier  spend: money }
      repository Customers for Customer { }
      ${contextExtra}
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource st { for: Orders, kind: state, use: pg }
  ui WebApp {
    framework: ${framework}
    api Sales: SalesApi
    page X { route: "/x/:id"  title: "X"  body: ${body} }
  }
  ${uiTopology(framework, "WebApp")}
}
`;

const UI_WITNESSES: Readonly<Record<UiConstruct, (framework: string) => string>> = {
  "primitive:DataGrid@body": (fw) =>
    uiWitness(
      fw,
      `QueryView { of: Sales.Customer.all, data: rows => DataGrid(Column("Name", o => o.name, sortable: true), rows: rows) }`,
    ),
  "primitive:Chart@body": (fw) =>
    uiWitness(
      fw,
      `Stack { Chart { kind: "bar", of: Sales.SpendByTier, x: r => r.tier, y: r => r.spend } }`,
      `projection SpendByTier {
        tier: Tier  spend: money
        from Customer as c
        group by c.tier
        select tier = c.tier, spend = sum(c.spend)
      }`,
    ),
  "read:entity-history@body": (fw) =>
    uiWitness(
      fw,
      `QueryView { of: Sales.Customer.history(id), data: entries => Timeline(entries) }`,
      "",
      "audited with crudish ",
    ),
};

/** An event-sourced aggregate whose create carries a `requires`, hosted on
 *  `platform`. */
const BACKEND_WITNESSES: Readonly<Record<BackendConstruct, (platform: string) => string>> = {
  "stmt:requires@event-sourced-create": (platform) => `
system W {
  subdomain Core {
    context Main {
      event Opened { thing: Thing id, label: string }
      aggregate Thing persistedAs: eventLog {
        label: string
        create open(label: string) {
          requires currentUser.role == "agent"
          emit Opened { thing: id, label: label }
        }
        apply(e: Opened) { label := e.label }
      }
      repository Things for Thing { }
    }
  }
  api MainApi from Core { }
  user { id: string  role: string }
  storage pg { type: postgres }
  resource st { for: Main, kind: state, use: pg }
  resource es { for: Main, kind: eventLog, use: pg }
  deployable d { platform: ${platform}, contexts: [Main], dataSources: [st, es], serves: MainApi, port: 3000, auth: required }
}
`,
};

// --- the cells ---------------------------------------------------------------

interface Cell {
  readonly id: string;
  readonly verdict: CapabilityVerdict;
  readonly source: string;
}

function cells(): Cell[] {
  const out: Cell[] = [];
  for (const [platform, table] of Object.entries(TARGET_CAPABILITIES)) {
    // `static` shares React's table object; one pass over it is enough.
    if (platform === "static") continue;
    for (const fw of table.ui?.frameworks ?? []) {
      for (const c of UI_CONSTRUCTS) {
        out.push({
          id: `${fw}|${c}`,
          verdict: table.ui!.constructs[c],
          source: UI_WITNESSES[c](fw),
        });
      }
    }
    for (const c of table.backend ? BACKEND_CONSTRUCTS : []) {
      out.push({
        id: `${platform}|${c}`,
        verdict: table.backend![c],
        source: BACKEND_WITNESSES[c](platform),
      });
    }
  }
  return out;
}

async function validateSource(src: string) {
  return validateLoomModel(enrichLoomModel(lowerModel(await parseValid(src))));
}

const OWNED_CODES = (): string[] =>
  cells().flatMap((c) => (c.verdict.verdict === "owned" ? [c.verdict.code] : []));

describe("capability table — every cell is implemented (with a witness) or refused (with a code)", () => {
  it("covers every UI framework and every backend", () => {
    // A vacuous pass would be a table nobody iterates.
    const ids = cells().map((c) => c.id.split("|")[0]);
    expect(new Set(ids)).toEqual(
      new Set([
        "react",
        "vue",
        "svelte",
        "angular",
        "feliz",
        "flutter",
        "phoenixLiveView",
        "node",
        "dotnet",
        "python",
        "java",
        "elixir",
      ]),
    );
  });

  for (const cell of cells()) {
    const v = cell.verdict;
    if (v.verdict === "supported") {
      it(`${cell.id}: supported — validates clean and renders with no give-up`, async () => {
        const diags = await validateSource(cell.source);
        expect(diags.filter((d) => d.code === "loom.target-unsupported")).toEqual([]);
        expect(diags.filter((d) => OWNED_CODES().includes(d.code ?? ""))).toEqual([]);
        const files = await generateSystemFiles(cell.source);
        const gaveUp = [...files]
          .filter(([, text]) => text.includes(GIVE_UP_SENTINEL))
          .map(([path]) => path);
        expect(gaveUp, `${cell.id} is marked supported but renders a give-up`).toEqual([]);
      });
    } else if (v.verdict === "refused") {
      it(`${cell.id}: refused — raises loom.target-unsupported#${v.slug}`, async () => {
        const diags = await validateSource(cell.source);
        const hit = diags.find((d) => d.code === "loom.target-unsupported");
        expect(hit, `${cell.id} is marked refused but nothing refuses it`).toBeDefined();
        expect(hit?.severity).toBe("error");
        const want = (DIAGNOSTIC_MESSAGES as Record<string, unknown>)[
          `loom.target-unsupported#${v.slug}`
        ];
        expect(want, `no catalog message for loom.target-unsupported#${v.slug}`).toBeDefined();
      });
    } else {
      it(`${cell.id}: owned — raises ${v.code}`, async () => {
        const diags = await validateSource(cell.source);
        expect(diags.map((d) => d.code)).toContain(v.code);
      });
    }
  }
});

describe("loom.target-unsupported — the check reads the table, and every detector bites", () => {
  const refuseAll = {
    ui: (): CapabilityVerdict => ({ verdict: "refused", slug: "datagrid" }),
    backend: (): CapabilityVerdict => ({ verdict: "refused", slug: "datagrid" }),
  };

  for (const c of UI_CONSTRUCTS) {
    it(`${c}: refusing it on react makes its witness fire`, async () => {
      const model = enrichLoomModel(lowerModel(await parseValid(UI_WITNESSES[c]("react"))));
      const sys = model.systems[0]!;
      expect(UI_DETECTORS[c](sys.uis[0]!, sys).length, `${c}'s detector misses its witness`).toBe(
        1,
      );
      const diags: Parameters<typeof validateTargetCapabilities>[1] = [];
      validateTargetCapabilities(sys, diags, {
        ui: (_fw, k) => (k === c ? refuseAll.ui() : { verdict: "supported" }),
        backend: () => undefined,
      });
      expect(diags.map((d) => d.code)).toEqual(["loom.target-unsupported"]);
    });
  }

  for (const c of BACKEND_CONSTRUCTS) {
    it(`${c}: refusing it on node makes its witness fire`, async () => {
      const model = enrichLoomModel(lowerModel(await parseValid(BACKEND_WITNESSES[c]("node"))));
      const sys = model.systems[0]!;
      const ctx = sys.subdomains[0]!.contexts[0]!;
      expect(BACKEND_DETECTORS[c](ctx).length, `${c}'s detector misses its witness`).toBe(1);
      const diags: Parameters<typeof validateTargetCapabilities>[1] = [];
      validateTargetCapabilities(sys, diags, {
        ui: () => ({ verdict: "supported" }),
        backend: (_p, k) => (k === c ? refuseAll.backend() : undefined),
      });
      expect(diags.map((d) => d.code)).toEqual(["loom.target-unsupported"]);
    });
  }

  it("every `loom.target-unsupported#<slug>` message is some row's reason", () => {
    const used = new Set<string>();
    for (const table of Object.values(TARGET_CAPABILITIES)) {
      const verdicts = [
        ...Object.values(table.ui?.constructs ?? {}),
        ...Object.values(table.backend ?? {}),
      ];
      for (const v of verdicts) if (v.verdict === "refused") used.add(v.slug);
    }
    // The fail-closed reasons count: an unknown framework is refused with them.
    for (const slug of Object.values(UI_CONSTRUCT_REFUSAL)) used.add(slug);
    const catalog = Object.keys(DIAGNOSTIC_MESSAGES)
      .filter((k) => k.startsWith("loom.target-unsupported#"))
      .map((k) => k.slice("loom.target-unsupported#".length));
    expect(catalog.sort()).toEqual([...used].sort());
  });
});
