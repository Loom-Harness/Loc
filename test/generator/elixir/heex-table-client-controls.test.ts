import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// CLIENT-side `Table` controls on HEEx — F2-MT640-SORT-DEAD (the gate ledger's
// one P1), the `G2646` pager arm, and `loom.table-filter-unsupported` (M-T1.1).
//
// A `find all(): T[]` (or any hand-written `Table` over a plain array) binds
// the WHOLE list, not a server window.  The four JSX frontends sort it, filter
// it and slice it in the browser; Phoenix used to drop all three args, so the
// same `.ddd` rendered an unsorted, unpaged, unfiltered table there and the
// scaffold's `sort_key` / `sort_dir` / `page_num` mount assigns sat dead.
//
// What this file pins, on the SAME model as the react deployable beside it:
//
//   1. the ROWS expression is filtered → sorted → sliced, in that order;
//   2. the whitelist carries `{wire key, struct field}` pairs, so no atom is
//      built from the `phx-value-key` payload;
//   3. the pager counts the FILTERED rows, not the sliced page;
//   4. the handlers write the assigns and do NOT refetch;
//   5. the `LoomTable` module is emitted exactly when a client control needs
//      it — and not otherwise;
//   6. a SERVER-paged table is untouched by any of it.
// ---------------------------------------------------------------------------

/** Scaffolded list over a NON-paged author `find all` → client sort + pager.
 *  A react deployable serves the same ui so the two frontends can be compared
 *  on one model (rule 12: the expectation comes from outside the emitter under
 *  test). */
const CLIENT_SRC = `
system Sales {
  subdomain M {
    context C {
      aggregate Order {
        code: string
        total: money
        derived display: string = code
      }
      repository Orders for Order {
        find all(): Order[]
      }
    }
  }
  api SalesApi from M
  ui SalesUi with scaffold(subdomains: [M]) { }
  storage loomDb { type: postgres }
  resource cState { for: C, kind: state, use: loomDb }
  deployable phoenixApp {
    platform: elixir, contexts: [C], dataSources: [cState], serves: SalesApi,
    ui: SalesUi, port: 4000
  }
  deployable web {
    platform: static, targets: phoenixApp, ui: SalesUi, port: 3000
  }
}
`;

/** A hand-written page with `Table { filter: q }` over a plain-array find —
 *  the shape `auto-paged-table.ts` leaves alone (it upgrades a table over a
 *  PAGED read, not over an array), so the filter reaches the walker. */
const FILTER_SRC = `
system Shop {
  subdomain M {
    context C {
      aggregate Product {
        sku: string
        name: string
        derived display: string = sku
      }
      repository Products for Product {
        find all(): Product[]
      }
    }
  }
  api ShopApi from M
  ui ShopUi {
    page Listing {
      route: "/listing"
      state { q: string = "" }
      body: QueryView(
        of: ShopApi.Product.all,
        data: rows => Table(
          Column("Sku", o => o.sku),
          Column("Name", o => o.name),
          rows: rows,
          filter: q
        )
      )
    }
  }
  storage loomDb { type: postgres }
  resource cState { for: C, kind: state, use: loomDb }
  deployable phoenixApp {
    platform: elixir, contexts: [C], dataSources: [cState], serves: ShopApi,
    ui: ShopUi, port: 4000
  }
  deployable web {
    platform: static, targets: phoenixApp, ui: ShopUi, port: 3000
  }
}
`;

/** Scaffolded list over a PAGED find — the server leg, unchanged. */
const SERVER_SRC = `
system Depot {
  subdomain M {
    context C {
      aggregate Crate {
        code: string
        derived display: string = code
      }
      repository Crates for Crate { }
    }
  }
  api DepotApi from M
  ui DepotUi with scaffold(subdomains: [M]) { }
  storage loomDb { type: postgres }
  resource cState { for: C, kind: state, use: loomDb }
  deployable phoenixApp {
    platform: elixir, contexts: [C], dataSources: [cState], serves: DepotApi,
    ui: DepotUi, port: 4000
  }
}
`;

async function files(src: string): Promise<Map<string, string>> {
  return await generateSystemFiles(src);
}

async function one(src: string, suffix: string): Promise<string> {
  for (const [p, c] of await files(src)) if (p.endsWith(suffix)) return c;
  throw new Error(`${suffix} not found`);
}

async function maybe(src: string, suffix: string): Promise<string | undefined> {
  for (const [p, c] of await files(src)) if (p.endsWith(suffix)) return c;
  return undefined;
}

describe("HEEx client table controls — the rows expression", () => {
  it("sorts and slices the bound rows in the template", async () => {
    const live = await one(CLIENT_SRC, "/order_list_live.ex");
    // Slice OUTSIDE sort: sorting the page window instead of the list would
    // order ten arbitrary rows and call it a sorted table.
    expect(live).toContain(
      "rows={PhoenixAppWeb.Components.LoomTable.page_rows(" +
        "PhoenixAppWeb.Components.LoomTable.sort_rows(@items, @sort_key, @sort_dir, ",
    );
    expect(live).toContain("), @page_num, 10)}");
  });

  it("passes a {wire key, struct field} whitelist, never the raw event key", async () => {
    const live = await one(CLIENT_SRC, "/order_list_live.ex");
    expect(live).toContain('[{"id", :id}, {"code", :code}, {"total", :total}');
    // The sort key arrives as `phx-value-key` from the browser.  Turning it
    // into an atom at runtime is an unbounded atom-table leak from an
    // unauthenticated event; the emitter's whitelist is what prevents it.
    const loomTable = await one(CLIENT_SRC, "/loom_table.ex");
    expect(loomTable).not.toContain("String.to_atom");
    expect(loomTable).not.toContain("String.to_existing_atom");
    expect(loomTable).toContain("List.keyfind(fields, to_string(key), 0)");
  });

  it("renders the pager over the WHOLE list, not the sliced page", async () => {
    const live = await one(CLIENT_SRC, "/order_list_live.ex");
    expect(live).toContain(
      "<.pager page={@page_num} total_pages={PhoenixAppWeb.Components.LoomTable.total_pages(@items, 10)} />",
    );
  });

  it("sorts every column the react target sorts, on the same model", async () => {
    // The expectation comes from the OTHER frontend's emitted source, not from
    // the HEEx emitter (rule 12): every field react's sortable header names
    // must appear in the Elixir whitelist.
    const reactFields = new Set<string>();
    for (const [p, c] of await files(CLIENT_SRC)) {
      if (!p.endsWith(".tsx")) continue;
      // The react header's own sort binding: `onClick={… setSortKey("code") …}`.
      for (const m of c.matchAll(/setSortKey\("(\w+)"\)/g)) reactFields.add(m[1]!);
    }
    expect([...reactFields].sort()).toEqual(["code", "id", "total", "version"]);
    const live = await one(CLIENT_SRC, "/order_list_live.ex");
    for (const f of reactFields) expect(live).toContain(`{"${f}", `);
  });

  it("pages with the SAME window size react slices with", async () => {
    let reactPageSize = "";
    for (const [p, c] of await files(CLIENT_SRC)) {
      if (!p.endsWith(".tsx")) continue;
      const m = /\.slice\(\(pageNum - 1\) \* (\d+), pageNum \* \d+\)/.exec(c);
      if (m) reactPageSize = m[1]!;
    }
    expect(reactPageSize).toBe("10");
    const live = await one(CLIENT_SRC, "/order_list_live.ex");
    expect(live).toContain(`, @page_num, ${reactPageSize})}`);
  });
});

describe("HEEx client table controls — the handlers", () => {
  it("writes the assigns and does not refetch", async () => {
    const live = await one(CLIENT_SRC, "/order_list_live.ex");
    expect(live).toContain('def handle_event("loom-sort", %{"key" => key}, socket) do');
    expect(live).toContain('def handle_event("loom-page", %{"page" => page}, socket) do');
    const clauses = live.slice(live.indexOf('"loom-sort"'));
    expect(clauses).toContain("|> assign(:sort_key, key)");
    expect(clauses).toContain("assign(socket, :page_num, page_num)");
    // No reload in either clause — the template re-derives the window.
    expect(clauses).not.toContain("list_orders");
  });

  it("still clamps a crafted page payload", async () => {
    const live = await one(CLIENT_SRC, "/order_list_live.ex");
    expect(live).toContain("case Integer.parse(to_string(page)) do");
    expect(live).toContain("{n, _} when n > 0 -> n");
  });
});

describe("HEEx `Table { filter: … }` — M-T1.1, the last frontend", () => {
  it("renders a bound search box above the table", async () => {
    const live = await one(FILTER_SRC, "/listing_live.ex");
    expect(live).toContain(
      '<.input type="search" name="q" value={@q} placeholder="Filter…" ' +
        'aria-label="Filter table" phx-change="update_q" data-testid="table-filter" />',
    );
    // …with the write-back clause the box needs to be anything but decorative.
    expect(live).toContain('def handle_event("update_q", %{"q" => value}, socket) do');
    expect(live).toContain("{:noreply, assign(socket, :q, value)}");
  });

  it("filters the rows the table renders", async () => {
    const live = await one(FILTER_SRC, "/listing_live.ex");
    expect(live).toContain("rows={PhoenixAppWeb.Components.LoomTable.filter_rows(@items, @q)}");
  });

  it("uses the same testid the react seam does, so one selector drives both", async () => {
    const reactFilterBoxes = [...(await files(FILTER_SRC))].filter(
      ([p, c]) => p.endsWith(".tsx") && c.includes('data-testid="table-filter"'),
    );
    // Vacuity guard: the claim is only worth anything if react really emits it.
    expect(reactFilterBoxes.length).toBeGreaterThan(0);
    const live = await one(FILTER_SRC, "/listing_live.ex");
    expect(live).toContain('data-testid="table-filter"');
  });
});

describe("HEEx client table controls — the LoomTable module", () => {
  it("is emitted once, and only when a client control uses it", async () => {
    const client = await maybe(CLIENT_SRC, "/loom_table.ex");
    expect(client).toBeDefined();
    // A server-paged project needs none of it.
    const server = await maybe(SERVER_SRC, "/loom_table.ex");
    expect(server).toBeUndefined();
  });

  it("compares decimals and datetimes by value, not by struct term order", async () => {
    const loomTable = await one(CLIENT_SRC, "/loom_table.ex");
    // Erlang term order on a %Decimal{} compares `coef` before `exp`, so
    // 1.5 (coef 15) sorts above 2 (coef 2); on a %DateTime{} it compares
    // `:calendar`, then `:day`, before `:year`.  Both are silently wrong
    // orderings a compile gate cannot see.
    expect(loomTable).toContain("defp sort_key(%Decimal{} = v), do: Decimal.to_float(v)");
    expect(loomTable).toContain("defp sort_key(%DateTime{} = v), do: DateTime.to_iso8601(v)");
    // …and a nil cell must not raise mid-render.
    expect(loomTable).toContain("defp sort_key(nil), do: nil");
    expect(loomTable).toContain('defp text(nil), do: ""');
  });

  it("leaves the rows alone on an unknown sort key or a non-list", async () => {
    const loomTable = await one(CLIENT_SRC, "/loom_table.ex");
    expect(loomTable).toContain("def sort_rows(rows, _key, _dir, _fields), do: rows");
    expect(loomTable).toContain("def filter_rows(rows, _query), do: rows");
    expect(loomTable).toContain("def page_rows(rows, _page, _size), do: rows");
    expect(loomTable).toContain("def total_pages(_rows, _size), do: 1");
  });
});

describe("HEEx server table controls — untouched", () => {
  it("keeps the server reload and emits no client transform", async () => {
    const live = await one(SERVER_SRC, "/crate_list_live.ex");
    expect(live).toContain(
      '<.table id="data-table" sort_key={@sort_key} sort_dir={@sort_dir} rows={@items.items}>',
    );
    expect(live).toContain("<.pager page={@page_num} total_pages={@items.totalPages} />");
    expect(live).not.toContain("LoomTable");
    const sortClause = live.slice(live.indexOf('"loom-sort"'), live.indexOf('"loom-page"'));
    expect(sortClause).toContain("list_crates(socket.assigns.page_num");
  });
});
