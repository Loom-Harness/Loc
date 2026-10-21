// A Phoenix LiveView `store` action renders through the backend's shared
// expression renderer, and the statement kinds a pure store module has no
// place for are refused at phase ⑦ instead of being dropped.
//
// The store module's own expression renderer used to cover literals, refs,
// members, arithmetic, lists and ternaries, and rendered everything else as
// `nil`: `count := lines.count()` emitted `%{state | count: nil}` on a model
// `ddd parse` called clean.  Its statement switch likewise passed the struct
// through for `precondition` / `requires` / `return` / `match await`, so each
// silently did nothing.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { parseString } from "../../_helpers/parse.js";

const system = (storeActions: string, platform = "elixir"): string => `
system Demo {
  subdomain S {
    context C {
      aggregate Order with crudish { customerId: string }
      repository Orders for Order { }
    }
  }
  api A from S
  ui Web {
    api C: A
    store Cart {
      state {
        lines: string[]
        count: int = 0
        label: string = ""
      }
${storeActions}
    }
    page CartPage {
      route: "/cart"
      action poke() { Cart.add("x") }
      body: Stack {
        Heading { Cart.count, level: 2 },
        Button { "Poke", onClick: poke }
      }
    }
  }
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable app {
    platform: ${platform}
    contexts: [C]
    dataSources: [st]
    serves: A
    ui: Web { C: app }
    port: 4000
  }
}`;

const RENDERED = system(`
      action add(sku: string) {
        lines += sku
        count := lines.count()
      }
      action relabel(n: int) { label := string(n) }
      action pick(n: int) { label := match { n > 1 => "many" else => "one" } }
`);

async function irCodes(source: string): Promise<string[]> {
  const { model, errors } = await parseString(source);
  if (errors.length) throw new Error(`unexpected parse/validation errors:\n${errors.join("\n")}`);
  return validateLoomModel(enrichLoomModel(lowerModel(model))).map((d) => d.code ?? "");
}

describe("LiveView store actions render through the shared Elixir expression renderer", () => {
  it("renders a method call, a conversion and a match instead of `nil`", async () => {
    const files = await generateSystemFiles(RENDERED);
    const store = files.get("app/lib/app_web/stores/cart.ex");
    expect(store, "store module emitted").toBeDefined();
    expect(store).toContain("%{state | count: Enum.count(state.lines)}");
    expect(store).toContain("%{state | label: to_string(n)}");
    expect(store).toContain('n > 1 -> "many"');
    expect(store).not.toMatch(/: nil\}/);
  });
});

describe("LiveView store actions refuse what a pure store module cannot hold", () => {
  for (const [label, body] of [
    ["precondition", "precondition n > 0\n        count := n"],
    ["requires", "requires n > 0\n        count := n"],
    [
      "match await",
      'match await C.Order.create(customerId: "c") {\n          Order o => count := 1\n          else => count := 2\n        }',
    ],
  ] as const) {
    it(`refuses \`${label}\` with loom.ui-body-statement-kind`, async () => {
      const codes = await irCodes(
        system(`      action guarded(n: int) {\n        ${body}\n      }`),
      );
      expect(codes).toContain("loom.ui-body-statement-kind");
    });
  }

  it("control: the same store actions on a react host are not refused for `match await`", async () => {
    const src = system(
      `      action guarded(n: int) {\n        match await C.Order.create(customerId: "c") {\n          Order o => count := 1\n          else => count := 2\n        }\n      }`,
      "node",
    )
      .replace("    ui: Web { C: app }\n", "")
      .replace(
        /\n}$/,
        "\n  deployable web { platform: react targets: app ui: Web { C: app } port: 3000 }\n}",
      );
    expect(src).toContain("platform: react");
    const codes = await irCodes(src);
    expect(codes).not.toContain("loom.ui-body-statement-kind");
  });

  it("control: a store action of writes and lets validates clean on LiveView", async () => {
    const codes = await irCodes(RENDERED);
    expect(codes).not.toContain("loom.ui-body-statement-kind");
  });
});
