// A page read on Phoenix LiveView calls the function the page NAMED.
//
// It did not.  `renderQueryLoadBlock` derived the context function from the
// read's SHAPE alone — list-shaped ⇒ `list_<agg>s`, single-shaped ⇒ `get_<agg>`
// — and never consulted the `of:` call's operation.  Every FILTERED read on this
// backend therefore loaded the unfiltered table, silently:
//
//   | page body                          | react                        | phoenix (was)        |
//   | `of: Item.findAllByLiveItems()`    | `useFindAllByLiveItemsItem()` | `list_items()`       |
//   | `of: Item.byState(Live)`           | `useByStateItem({state})`     | `list_items(:Live)`  |
//
// The second row is not merely wrong data: `list_items/4` is
// `(page \\ 1, page_size \\ 20, sort \\ "id", dir \\ "asc")`, so the FILTER VALUE
// arrived as the page number.  The single-record path had the twin defect — a
// find returning `T?` became `get_<agg>(socket.assigns.id)`, reaching for a route
// assign a filtered page never binds.
//
// So these tests assert the CALLED FUNCTION, per read shape, against the
// `defdelegate` the context module actually emits (`vanilla/context-emit.ts`) —
// which is why each one also pins the delegate it is calling.  A test that only
// checked "the emitted page mentions the find" would pass against a page that
// mentions it in a comment.
//
// The last two pin the refusal: a read that resolves to NO declaration is
// rejected by `loom.ui-read-unresolved`, and the emitter — reached only by a
// caller that skipped validation — refuses it too rather than falling back to the
// list it used to substitute.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { generateSystemFiles, generateSystemFilesUnchecked } from "../../_helpers/index.js";
import { parseString } from "../../_helpers/parse.js";

/** One elixir deployable mounting a ui whose pages carry `pages`.  `Shop` grows
 *  a criterion-backed paged find (via `scaffoldPaged`), a parameterised find and
 *  a single-record find, so every read shape below names a real declaration. */
function sys(pages: string): string {
  return `
system HeexRead {
  subdomain Core {
    context Shop with scaffoldPaged(of: LiveItems) {
      enum St { Draft, Live }
      aggregate Item {
        name: string
        st: St
        derived display: string = name
      }
      repository Items for Item {
        find byState(state: St): Item[] where this.st == state
        find byName(n: string): Item?
      }
      criterion LiveItems of Item = st == Live
    }
  }
  api ShopApi with scaffoldPagedApi(of: LiveItems) { }
  ui WebApp {
    ${pages}
  }
  storage primary { type: postgres }
  resource s { for: Shop, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Shop]
    dataSources: [s]
    serves: ShopApi
    ui: WebApp
    port: 4000
  }
}
`;
}

const LIST_PAGE = (name: string, route: string, ofExpr: string): string => `
    page ${name} {
      route: "${route}"
      title: "${name}"
      body: QueryView {
        of: ${ofExpr},
        data: rows => Stack { For { each: rows, i => Text { i.name } } }
      }
    }`;

async function emitted(pages: string): Promise<{ live: (p: string) => string; context: string }> {
  const files = await generateSystemFiles(sys(pages));
  return {
    live: (p) => files.get(`api/lib/api_web/live/${p}`) ?? "",
    context: files.get("api/lib/api/shop.ex") ?? "",
  };
}

describe("HEEx page reads call the function the page named", () => {
  it("a criterion-backed paged find loads `find_all_by_<crit>_<agg>`, not the whole table", async () => {
    const out = await emitted(LIST_PAGE("OnlyLive", "/only-live", "Item.findAllByLiveItems()"));
    const page = out.live("only_live_live.ex");
    expect(page).toContain("case Api.Shop.find_all_by_live_items_item() do");
    // The substitution this replaced.  A `list_items` anywhere in this page is
    // the defect back.
    expect(page).not.toContain("list_items");
    // …and the delegate it calls is one the context module emits.
    expect(out.context).toContain("defdelegate find_all_by_live_items_item(");
  });

  it("a parameterised find passes its ARGUMENT to that find, not to `list/4`'s page slot", async () => {
    const out = await emitted(LIST_PAGE("ByState", "/by-state", "Item.byState(Live)"));
    const page = out.live("by_state_live.ex");
    expect(page).toContain("case Api.Shop.by_state_item(:Live) do");
    expect(page).not.toContain("list_items(:Live)");
    // `by_state_item/1` takes the filter; `list_items/4` takes the page number.
    // The old emit passed `:Live` to the latter.
    expect(out.context).toContain("defdelegate by_state_item(state)");
  });

  it("a single-record find loads that find with ITS argument, not `get_<agg>(route id)`", async () => {
    const out = await emitted(`
    page OneItem {
      route: "/one"
      title: "OneItem"
      body: QueryView { of: Item.byName("abc"), data: d => Text { d.name } }
    }`);
    const page = out.live("one_item_live.ex");
    expect(page).toContain(`case Api.Shop.by_name_item("abc") do`);
    expect(page).not.toContain("get_item(socket.assigns.id)");
    // `Repo.one/1` yields `{:ok, nil}` on a miss — without this arm the page
    // renders its DATA slot over `nil`.  The by-id fetch never yields it, so the
    // arm is emitted only here.
    expect(page).toContain("{:ok, nil} -> assign(socket, :d, :not_found)");
  });

  it("the auto-`findAll` and `byId` still route to `list_<agg>s` / `get_<agg>`", async () => {
    const out = await emitted(`${LIST_PAGE("AllItems", "/all", "Item.all")}
    page ItemDetail {
      route: "/items/:id"
      title: "ItemDetail"
      body: QueryView { of: Item.byId(id), data: d => Text { d.name } }
    }`);
    expect(out.live("all_items_live.ex")).toContain("case Api.Shop.list_items() do");
    const detail = out.live("item_detail_live.ex");
    expect(detail).toContain("case Api.Shop.get_item(socket.assigns.id) do");
    // The by-id fetch's absence is `{:error, :not_found}`, so it keeps the
    // three-arm shape it always had.
    expect(detail).not.toContain("{:ok, nil} ->");
  });
});

describe("a page read that names nothing is refused, not substituted", () => {
  // `findAllByLiveItems` exists only where `scaffoldPaged` synthesized it.
  // Without that macro the criterion is declared but no find is — the exact
  // shape the audit hit, and the one that used to render the whole table.
  const UNDECLARED = `
system HeexUnresolved {
  subdomain Core {
    context Shop {
      enum St { Draft, Live }
      aggregate Item {
        name: string
        st: St
        derived display: string = name
      }
      repository Items for Item { }
      criterion LiveItems of Item = st == Live
    }
  }
  ui WebApp {
    page OnlyLive {
      route: "/only-live"
      title: "OnlyLive"
      body: QueryView {
        of: Item.findAllByLiveItems(),
        data: rows => Stack { For { each: rows, i => Text { i.name } } }
      }
    }
  }
  storage primary { type: postgres }
  resource s { for: Shop, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Shop]
    dataSources: [s]
    ui: WebApp
    port: 4000
  }
}
`;

  it("raises `loom.ui-read-unresolved`, naming what the aggregate does expose", async () => {
    const { model } = await parseString(UNDECLARED, { validate: false });
    const diags = validateLoomModel(enrichLoomModel(lowerModel(model))).filter(
      (d) => d.code === "loom.ui-read-unresolved",
    );
    expect(diags).toHaveLength(1);
    expect(diags[0]!.severity).toBe("error");
    expect(diags[0]!.message).toContain("Item.findAllByLiveItems");
    expect(diags[0]!.message).toContain("'Item' exposes: all, byId.");
  });

  it("the emitter refuses the read rather than loading the unfiltered list", async () => {
    const files = await generateSystemFilesUnchecked(
      UNDECLARED,
      "the model is exactly the one loom.ui-read-unresolved rejects; this pins the emitter backstop",
    );
    const page = files.get("api/lib/api_web/live/only_live_live.ex")!;
    expect(page).not.toContain("list_items");
    expect(page).toContain("read refused");
    expect(page).toContain("socket = assign(socket, :items, :error)");
  });
});
