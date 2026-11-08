// A repository read in an expression position of a handler / workflow body —
// `return Items.getBy(sku: s)`, `return Items.all(Big(n)).count`,
// `return Items.get(id).sku` — runs as a `let` hoisted ahead of its statement
// (`src/ir/lower/hoist-reads.ts`), so every backend renders the same
// repository call its `let x = …; return x` spelling renders.  Without the
// hoist the read lowered as a method call on the unresolved repository name
// (node `items.toWire(Items.getBy(sku))`) and a criterion `all(<C>)` as the
// collection quantifier (`(Items).every(this.qty > n).length`).
//
// A read the body evaluates only on some paths cannot be hoisted and is
// refused (`loom.workflow-inline-repository-call`, IR half in
// `test/ir/handler-inline-repository-call.test.ts`).

import { beforeAll, describe, expect, it } from "vitest";
import {
  assertNodeTypesAvailable,
  formatUnbound,
  unboundSymbols,
} from "../_helpers/emitted-binding.js";
import { generateSystemFiles } from "../_helpers/generate.js";

const SRC = `
system S {
  subdomain D { context Shop {
    aggregate Item with crudish { sku: string  qty: int  unique (sku) }
    repository Items for Item { }
    criterion Big(n: int) of Item = this.qty > n
    queryHandler GetItemBySku(sku: string): Item { return Items.getBy(sku: sku) }
    queryHandler GetItem(itemId: Item id): Item { return Items.get(itemId) }
    queryHandler AllItems(): Item[] { return Items.all() }
    queryHandler CountBig(n: int): int { return Items.all(Big(n)).count }
    queryHandler SkuOf(itemId: Item id): string { return Items.get(itemId).sku }
    commandHandler Touch(itemId: Item id) {
      precondition Items.get(itemId).qty >= 0
      requires Items.all(Big(0)).count >= 0
    }
    commandHandler Sweep(n: int) { for o in Items.all(Big(n)) { o.update(o.sku, 0) } }
  }}
  api A from D {
    route GET "/by_sku" -> Shop.GetItemBySku
    route GET "/one/{itemId}" -> Shop.GetItem
    route GET "/all" -> Shop.AllItems
    route GET "/big" -> Shop.CountBig
    route GET "/sku/{itemId}" -> Shop.SkuOf
    route POST "/touch/{itemId}" -> Shop.Touch
    route POST "/sweep" -> Shop.Sweep
  }
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable api { platform: node, contexts: [Shop], dataSources: [st], serves: A, port: 3000 }
  deployable apy { platform: python, contexts: [Shop], dataSources: [st], serves: A, port: 3001 }
  deployable aj { platform: java, contexts: [Shop], dataSources: [st], serves: A, port: 3002 }
  deployable ad { platform: dotnet, contexts: [Shop], dataSources: [st], serves: A, port: 3003 }
  deployable ae { platform: elixir, contexts: [Shop], dataSources: [st], serves: A, port: 3004 }
}
`;

let files: Map<string, string>;
beforeAll(async () => {
  files = await generateSystemFiles(SRC);
}, 120_000);

function file(path: string): string {
  const content = files.get(path);
  if (content === undefined) {
    const near = [...files.keys()].filter((k) => k.startsWith(path.split("/")[0]!));
    throw new Error(`no generated ${path}; near:\n${near.slice(0, 40).join("\n")}`);
  }
  return content;
}

/** Every backend's rendering of one handler: the read bound to the hoisted
 *  local, then the answer read off it. */
const CASES: { backend: string; path: string; expect: string[]; never: string[] }[] = [
  {
    backend: "node",
    path: "api/http/a-routes.ts",
    expect: [
      "const readItems = await items.getBySku(sku);",
      "const readItems = await items.getById(itemId);",
      "const readItems = await items.runFindAllByBig(n);",
      "readItems.length",
      "readItems.sku",
    ],
    never: ["Items.getBy(", "(Items).every(", "= Items.get("],
  },
  {
    backend: "python",
    path: "apy/app/application/count_big.py",
    expect: ["read_items = await items.run_find_all_by_big(n)", "return len(read_items)"],
    never: ["for __x in Items"],
  },
  {
    backend: "python",
    path: "apy/app/application/get_item_by_sku.py",
    expect: ["read_items = await items.get_by_sku(sku)", "items.to_wire(read_items)"],
    never: ["Items.get_by"],
  },
  {
    backend: "java",
    path: "aj/src/main/java/com/loom/aj/application/workflows/CountBigHandler.java",
    expect: ["var readItems = itemsRepository.runFindAllByBig(n);", "return readItems.size();"],
    never: ["allMatch"],
  },
  {
    backend: "java",
    path: "aj/src/main/java/com/loom/aj/application/workflows/SkuOfHandler.java",
    expect: ["var readItems = itemsRepository.getById(itemId);", "return readItems.sku();"],
    never: ["Items.get"],
  },
  {
    backend: "dotnet",
    path: "ad/Application/Items/Queries/CountBigHandler.cs",
    expect: [
      "var readItems = await _items.RunFindAllByBigAsync(command.N",
      "return readItems.Count;",
    ],
    never: ["(Items).All("],
  },
  {
    backend: "dotnet",
    path: "ad/Application/Items/Queries/GetItemBySkuHandler.cs",
    expect: ["var readItems = await _items.GetBySku(command.Sku", "return readItems;"],
    never: ["Items.GetBy("],
  },
  {
    backend: "elixir",
    path: "ae/lib/ae/shop/handlers/count_big.ex",
    expect: ["{:ok, read_items} <- Context.run_find_all_by_big_item(n)", "Enum.count(read_items)"],
    never: ["Enum.all?(items"],
  },
  {
    backend: "elixir",
    path: "ae/lib/ae/shop/handlers/sku_of.ex",
    expect: ["{:ok, read_items} <- (case Context.get_item(item_id)", "{:ok, read_items.sku}"],
    never: ["items.get_by_id"],
  },
];

describe("a repository read in expression position runs as a hoisted let (all five backends)", () => {
  for (const c of CASES) {
    it(`${c.backend}: ${c.path}`, () => {
      const src = file(c.path);
      for (const e of c.expect) expect(src).toContain(e);
      for (const n of c.never) expect(src).not.toContain(n);
    });
  }

  it("node: a read in a precondition and a requires gate runs ahead of its statement", () => {
    const src = file("api/http/a-routes.ts");
    expect(src).toContain("if (!(readItems.qty >= 0))");
    expect(src).toContain("const readItems2 = await items.runFindAllByBig(0);");
    expect(src).toContain("readItems2.length >= 0");
  });

  it.each([
    ["node", "api/http/a-routes.ts", "for (const o of readItems) {"],
    ["python", "apy/app/application/sweep.py", "for o in read_items:"],
    [
      "java",
      "aj/src/main/java/com/loom/aj/application/workflows/SweepHandler.java",
      "for (var o : readItems)",
    ],
    ["dotnet", "ad/Application/Items/Commands/SweepHandler.cs", "foreach (var o in readItems)"],
    ["elixir", "ae/lib/ae/shop/handlers/sweep.ex", "Enum.reduce_while(read_items,"],
  ])("%s: a `for` iterable read runs as a hoisted let the loop iterates", (_b, path, loop) => {
    const src = file(path);
    expect(src).toContain(loop);
    expect(src).not.toContain("(Items).every(");
    expect(src).not.toContain("Enum.all?(items");
  });

  it("node: the emitted routes bind every name they read (no dangling repository)", () => {
    assertNodeTypesAvailable();
    const found = unboundSymbols(files, "api");
    expect(found, formatUnbound(found)).toEqual([]);
  });
});
