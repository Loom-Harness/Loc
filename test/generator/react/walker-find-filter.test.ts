// Find-filter list UI (T3.14, hook-only v1) + `match` in body position.
//
// A repository `find` whose params are all plain strings and whose
// return is an unwrapped list gives the scaffolded list page a filter
// bar: one bound text input per param, and a `match`-driven switch —
// when every input of a find is non-empty the list renders that find's
// results, else `all`.  The find hook hoists with the OBJECT-shaped
// query arg its emitted signature takes (`use<Find><Agg>(query)`).

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

describe("match expression in body position", () => {
  it("renders as a brace-wrapped chained ternary walking each arm as JSX", async () => {
    const files = await generateSystemFiles(`
      system S {
        subdomain Sub { context C { } }
        ui W {
          page Home {
            route: "/"
            state { tab: string = "a" }
            body: Stack {
              match {
                tab == "a" => Heading { "Alpha" }
                tab == "b" => Heading { "Beta" }
                else => Text { "neither" }
              }
            }
          }
        }
        deployable api { platform: node, contexts: [C], port: 3000 }
        deployable web { platform: static, targets: api, ui: W, port: 3001 }
      }
    `);
    const home = files.get("web/src/pages/home.tsx")!;
    expect(home).toContain('((tab === "a")) ? (');
    expect(home).toContain('((tab === "b")) ? (');
    expect(home).toContain(', "Alpha")}</');
    expect(home).toContain(', "Beta")}</');
    expect(home).toContain(', "neither")}</');
  });
});
