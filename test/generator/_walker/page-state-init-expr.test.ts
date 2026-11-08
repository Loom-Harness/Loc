// A page `state {}` initializer is rendered through each frontend's real
// expression emitter, so any constant expression — not just a bare literal —
// boots the field at its declared value.  A literal-only reader answered
// `undefined` for `-5` (a `unary`) or `1 + 1` (a `binary`), and the field
// silently mounted at the type's zero instead.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const sys = (framework: string) => `
system InitExpr {
  subdomain S {
    context Ops {
      aggregate Job { name: string }
      repository Jobs for Job { }
    }
  }
  ui App {
    framework: ${framework}
    page Counter {
      route: "/counter"
      state {
        below: int = -5
        sum: int = 1 + 1
        label: string = "ready"
      }
      body: Stack { Text { label } }
    }
  }
  api OpsApi from S
  storage primary { type: postgres }
  resource st { for: Ops, kind: state, use: primary }
  deployable api { platform: node contexts: [Ops] dataSources: [st] serves: OpsApi port: 4400 }
  deployable app { platform: static targets: api ui: App port: 3007 }
}`;

async function pageSource(framework: string): Promise<string> {
  const files = await generateSystemFiles(sys(framework));
  let out = "";
  for (const [p, c] of files) if (/counter/i.test(p)) out += `\n${c}`;
  return out;
}

describe("page state initializers honour constant expressions", () => {
  for (const framework of ["react", "svelte", "vue", "angular"]) {
    it(`${framework}: boots -5, 1 + 1 and a string at their declared values`, async () => {
      const src = await pageSource(framework);
      expect(src, "no page file was emitted").not.toBe("");
      expect(src).toMatch(/\(\s*-\s*5\s*\)|\(-5\)/);
      expect(src).toMatch(/1 \+ 1/);
      expect(src).toContain('"ready"');
    });
  }
});
