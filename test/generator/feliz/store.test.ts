// Feliz frontend — store subsystem (M-T6.15).
//
// A `store` folds into the SINGLE-program Elmish MVU: each store field becomes
// a namespaced Model field (`Cart` + `count` → `CartCount`), each store action
// a Msg case (`CartClear`) with an update arm under a store-scope, a store-field
// read binds a page-view local (`let count = model.CartCount`), and a store
// action call from a page action dispatches (`Cmd.ofMsg (CartAdd …)`).  The
// emitted App.fs is proven to `dotnet fable`-compile in CI.

import { describe, expect, it } from "vitest";
import { generateFelizForContexts } from "../../../src/generator/feliz/index.js";
import { buildLoomModel } from "../../_helpers/ir.js";

const SYS = `
system P {
  subdomain S { context C { } }
  ui WebApp {
    store Cart {
      state { lines: string[]  count: int = 0 }
      action add(sku: string) { lines += sku  count += 1 }
      action clear() { lines := [ ]  count := 0 }
    }
    page Home {
      route: "/"
      action addOne() { Cart.add("SKU-1") }
      action discard() { Cart.clear() }
      body: Stack {
        Heading { "Cart", level: 1 },
        Text { \`Items: {Cart.count}\` },
        For { each: Cart.lines, line => Card { line } },
        Button { "Add", onClick: addOne }
      }
    }
  }
  deployable api { platform: node contexts: [C] port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp port: 3005 }
}`;

async function app(): Promise<string> {
  const model = await buildLoomModel(SYS);
  const sys = model.systems[0]!;
  const web = sys.deployables.find((d) => d.name === "web")!;
  return generateFelizForContexts([], sys, web).get("src/App.fs")!;
}

describe("feliz store subsystem (M-T6.15)", () => {
  it("folds store state into the Model as namespaced fields", async () => {
    const fs = await app();
    expect(fs).toContain("CartLines: string list");
    expect(fs).toContain("CartCount: int");
  });

  it("seeds store fields in init from their declared defaults", async () => {
    const fs = await app();
    expect(fs).toContain("CartLines = []");
    expect(fs).toContain("CartCount = 0");
  });

  it("emits a Msg case + a store-scoped update arm per store action", async () => {
    const fs = await app();
    expect(fs).toContain("| CartAdd of string");
    expect(fs).toContain("| CartClear");
    expect(fs).toContain("| CartAdd sku ->");
    expect(fs).toContain("{ model with CartLines = (model.CartLines @ [ sku ]) }");
    expect(fs).toContain("{ model with CartCount = (model.CartCount + 1) }");
    expect(fs).toContain("| CartClear ->");
  });

  it("dispatches a store action called from a page action via Cmd.ofMsg", async () => {
    const fs = await app();
    expect(fs).toContain('Cmd.ofMsg (CartAdd "SKU-1")');
    expect(fs).toContain("Cmd.ofMsg (CartClear)");
  });

  it("binds store-field reads to page-view locals off the Model", async () => {
    const fs = await app();
    expect(fs).toContain("let count = model.CartCount");
    expect(fs).toContain("let lines = model.CartLines");
    // the `For { each: Cart.lines }` iterates the bound local
    expect(fs).toContain("lines |> List.map");
  });

  it("leaves no silent-drop markers", async () => {
    const fs = await app();
    expect(fs).not.toContain("// TODO feliz");
    expect(fs).not.toContain("unsupported");
  });
});

describe("feliz store-action as a direct onClick handler (M-T6.15)", () => {
  const DIRECT = `
system P {
  subdomain S { context C { } }
  ui WebApp {
    store Cart { state { count: int = 0 } action clear() { count := 0 } }
    page Home {
      route: "/"
      body: Stack { Heading { Cart.count, level: 1 }, Button { "Clear", onClick: Cart.clear } }
    }
  }
  deployable api { platform: node contexts: [C] port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp port: 3005 }
}`;
  it("binds the store-action dispatcher and wires the button onClick", async () => {
    const model = await buildLoomModel(DIRECT);
    const sys = model.systems[0]!;
    const web = sys.deployables.find((d) => d.name === "web")!;
    const fs = generateFelizForContexts([], sys, web).get("src/App.fs")!;
    expect(fs).toContain("let clear () = dispatch CartClear");
    expect(fs).toContain("prop.onClick (fun _ -> clear())");
  });
});
// Wave C2 packet 2i.  Three `state {}` cell types emitted F# that could not
// compile, from a `.ddd` reporting `0 error(s), 0 warning(s)` — nothing to do
// with `persist:`, so an in-memory store is the fixture:
//
//   enum      `typeToFs` spelled the enum's own name (`FiltersMode: Status`,
//             `| FiltersSetMode of Status`) and NO `type Status` is ever
//             emitted into App.fs — FS0039, undefined type.  Every other seam
//             on this frontend spells an enum `string` (`wireFieldType`,
//             `decoderExprFor`, the query encoder, `claimFsType`).
//   datetime  `fsZeroValue` fell through to `""` against a
//   guid      `System.DateTime` / `System.Guid` field — a type error in `init`.
describe("feliz store — enum / datetime / guid state cells (silent-codegen fix)", () => {
  const CELLS = `
system P {
  subdomain S { context C { enum Status { open closed } } }
  ui WebApp {
    store Filters {
      state { mode: Status  at: datetime  ref: guid }
      action setMode(m: Status) { mode := m }
    }
    page Home {
      route: "/"
      body: Stack { Heading { "Home", level: 1 } }
    }
  }
  deployable api { platform: node contexts: [C] port: 3000 }
  deployable web { platform: feliz targets: api ui: WebApp port: 3005 }
}`;

  async function cellsApp(): Promise<string> {
    const model = await buildLoomModel(CELLS);
    const sys = model.systems[0]!;
    const web = sys.deployables.find((d) => d.name === "web")!;
    return generateFelizForContexts([], sys, web).get("src/App.fs")!;
  }

  it("types an enum cell (and its action payload) as `string`, never the enum name", async () => {
    const fs = await cellsApp();
    expect(fs).toContain("FiltersMode: string");
    expect(fs).toContain("| FiltersSetMode of string");
    // The proof it matters: no `type Status` is emitted, so the old spelling
    // referenced a type that does not exist.
    expect(fs).not.toContain("type Status");
    expect(fs).not.toContain("FiltersMode: Status");
  });

  it("seeds a datetime cell with the .NET zero its field type accepts", async () => {
    const fs = await cellsApp();
    expect(fs).toContain("FiltersAt: System.DateTime");
    expect(fs).toContain("FiltersAt = System.DateTime.MinValue");
    expect(fs).not.toContain('FiltersAt = ""');
  });

  // The guid half of the same cell goes the OTHER way, and for the same
  // reason — the zero has to match the field's declared type, and on this
  // frontend a Loom `guid` IS an F# `string`: `fsPrimitive` has no `guid` arm,
  // `decoderExprFor` decodes one with `Decode.string`, and the query encoder
  // passes it verbatim.  Spelling the cell `System.Guid` made the RECORD field
  // disagree with its own decoder (`FS0001: The type 'System.Guid' does not
  // match the type 'string'`) on every guid-carrying wire record, which is a
  // strictly worse failure than the `""` seed it was meant to fix.  String
  // field, string zero.
  it("seeds a guid cell as the string it is", async () => {
    const fs = await cellsApp();
    expect(fs).toContain("FiltersRef: string");
    expect(fs).toContain('FiltersRef = ""');
    expect(fs).not.toContain("System.Guid");
  });
});
