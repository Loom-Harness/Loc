// A store field's declared default boots the field on every JS-family
// frontend — enum values, ternaries and `string(…)` included — and a default
// that is not a constant is refused rather than booting at the type's zero.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { parseString } from "../../_helpers/parse.js";

const sys = (framework: string, state: string) => `
enum Theme { light, dark }
system Prefs {
  subdomain S {
    context Ops {
      aggregate Job with crudish { name: string }
      repository Jobs for Job { }
    }
  }
  ui App {
    framework: ${framework}
    store Settings {
      state {
${state}
      }
    }
    page Home {
      route: "/"
      body: Stack { Text { "x" } }
    }
  }
  api OpsApi from S
  storage primary { type: postgres }
  resource st { for: Ops, kind: state, use: primary }
  deployable api { platform: node contexts: [Ops] dataSources: [st] serves: OpsApi port: 4400 }
  deployable app { platform: static targets: api ui: App port: 3007 }
}`;

const CONSTANTS = `
        mode: Theme = Theme.dark
        retries: int = true ? 3 : 1
        code: string = string(42)
        budget: money = 10.00 + 5.00
        label: string = "ready"`;

async function storeSource(framework: string): Promise<string> {
  const files = await generateSystemFiles(sys(framework, CONSTANTS));
  let out = "";
  for (const [p, c] of files) if (/store/i.test(p) && /retries/.test(c)) out += `\n${c}`;
  return out;
}

describe("store field defaults boot at their declared value", () => {
  for (const framework of ["react", "vue", "svelte", "angular"]) {
    it(`${framework}: enum value, ternary, string(…), money expression`, async () => {
      const src = await storeSource(framework);
      expect(src, "no store module was emitted").not.toBe("");
      expect(src).toContain('"dark"');
      expect(src).toContain("(true ? 3 : 1)");
      expect(src).toContain("String(42)");
      expect(src).toContain("new Decimal((10.00 + 5.00))");
      expect(src).toContain('"ready"');
    });
  }
});

describe("loom.store-init-not-constant", () => {
  async function codes(framework: string, state: string): Promise<string[]> {
    const { model } = await parseString(sys(framework, state), { validate: false });
    return validateLoomModel(enrichLoomModel(lowerModel(model)))
      .filter((d) => d.severity === "error")
      .map((d) => d.code ?? "");
  }

  it("refuses a default that reads a runtime value", async () => {
    expect(await codes("react", `        stamp: string = now().toString()`)).toContain(
      "loom.store-init-not-constant",
    );
  });

  it("accepts every admitted constant form", async () => {
    expect(await codes("react", CONSTANTS)).not.toContain("loom.store-init-not-constant");
  });
});
