import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

// A component `derived` that reads an id-TYPED member (`item.parent`, whose
// memberType is the TypeIR `{ kind: "id" }`) is not a route-`id` read.  The
// page-scope probes match the ExprIR `id` node only; a reflective child walk
// that also enters `memberType` mistook the type for that node and deferred
// the component.

const SYS = (platform: "feliz" | "flutter") => `
system S {
  api A from D
  subdomain D { context C {
    aggregate Item { name: string  parent: Item id  derived display: string = name }
    repository Items for Item {}
  } }
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  ui App {
    framework: ${platform}
    api Shop: A
    component ParentTag(item: Item) {
      derived parentOf: Item id = item.parent
      body: Stack { Text { string(parentOf) } }
    }
    page Home {
      route: "/"
      body: QueryView { of: Shop.Item.all, loading: Text { "…" }, error: Text { "e" }, empty: Text { "none" },
        data: rows => Stack { For { each: rows, p => ParentTag(item: p) } } }
    }
  }
  deployable api1 { platform: node contexts: [C] dataSources: [st] serves: A port: 8081 }
  deployable app { platform: ${platform} targets: api1 ui: App { Shop: api1 } port: 3006 }
}`;

describe("component derived over an id-typed member", () => {
  it.each([
    ["feliz", "src/App.fs", "ParentTag"],
    ["flutter", "lib/components.dart", "class ParentTag"],
  ] as const)("%s keeps the component (no route-id false positive)", async (platform, suffix, needle) => {
    const files = await generateSystemFiles(SYS(platform));
    const src = [...files.entries()].find(([k]) => k.endsWith(suffix))?.[1] ?? "";
    expect(src).toContain(needle);
  });
});
