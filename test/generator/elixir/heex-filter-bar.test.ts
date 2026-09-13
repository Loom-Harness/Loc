// The scaffolded list page's filter bar FILTERS on Phoenix LiveView.
//
// It did not — in three independent ways, each of which alone is enough to make
// the bar decorative (audit P10, `docs/audits/2026-09-10-eshop-dev-experience.md`;
// reported in #2870's closing section, which fixed only the arm's CALL):
//
//  1. THE LOAD BLOCK WAS UNGUARDED.  The markup is a `cond` — one arm per filter
//     `find`, an `all` fallback last — but the reads those arms register were
//     pushed into `handle_params/3` as a FLAT sequence, in body order, every one
//     of them writing `:items`.  The `all` fallback came last, so it overwrote
//     whatever the filtered arm had just fetched: the filter query ran, hit the
//     database, and had its rows discarded one line later.
//
//  2. THE TWO ARMS DISAGREED ON SHAPE.  The filtered arm's markup reads `@items`
//     as a plain list (`Enum.empty?(@items)`, `rows={@items}`), the `all` arm as
//     the paged envelope (`@items.items`, `@items.totalPages`).  Each reading is
//     right FOR ITS ARM; they conflict only because both loads ran.  So the
//     guard settles this one too — but it has to be settled per-arm, which is
//     what the pairing assertion below pins.
//
//  3. THE INPUT WAS INERT.  `controlledInput` tested `ctx.stateNames.has(bind)`
//     with `bind` in the `.ddd`'s camelCase spelling against a set keyed by the
//     SNAKE-CASED assign name.  That membership test can only succeed for a
//     one-word field, so every multi-word bound input fell through to the
//     `name="_unbound" … disabled` stub — and a scaffolded filter field is
//     `<find><Param>` by construction, never one word.  The backing assign sat
//     in `mount/3`, unread.
//
//  …and a fourth, which the first three expose rather than fix: a LiveView has
//  no `useQuery` to invalidate, so the input's write-back clause must RE-RUN the
//  reads that depend on the assign it just wrote.  Without that, typing flips
//  the render `cond` into the filtered arm while `@items` still holds the `all`
//  arm's envelope — defect 2, at runtime, from the other side.
//
// The reference is the React scaffold's bar on the SAME model, asserted beside
// each Phoenix claim: a user typing in the Phoenix box must get the rows React
// gives them.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

/** One elixir deployable and one react deployable over the same scaffolded
 *  context, so every claim below can be stated against both frontends.
 *  `find byName(n: string): Item[]` is the bar-eligible shape — the scaffold
 *  turns it into one text input plus one `match` arm. */
const SYS = `
system FilterBar {
  subdomain Retail {
    context Catalog {
      aggregate Item {
        name: string
      }
      repository Items for Item {
        find byName(n: string): Item[]
      }
    }
  }
  api CatalogApi from Retail
  ui Live with scaffold(contexts: [Catalog]) { api Catalog: CatalogApi }
  ui Web with scaffold(contexts: [Catalog]) { api Catalog: CatalogApi }
  storage primary { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Catalog]
    dataSources: [catalogState]
    serves: CatalogApi
    ui: Live { Catalog: api }
    port: 4000
  }
  deployable web {
    platform: react
    ui: Web { Catalog: api }
    targets: api
    port: 3000
  }
}
`;

/** A page with NO `match` — the byte-identity control for every guard claim. */
const UNFILTERED = `
system NoFilterBar {
  subdomain Retail {
    context Catalog {
      aggregate Item { name: string }
      repository Items for Item { }
    }
  }
  api CatalogApi from Retail
  ui Live {
    api Catalog: CatalogApi
    page Items {
      route: "/items"
      title: "Items"
      body: QueryView { of: Catalog.Item.all, data: rows => Stack { For { each: rows, i => Text { i.name } } } }
    }
  }
  storage primary { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Catalog]
    dataSources: [catalogState]
    serves: CatalogApi
    ui: Live { Catalog: api }
    port: 4000
  }
}
`;

async function scaffolded(): Promise<{ live: string; tsx: string }> {
  const files = await generateSystemFiles(SYS);
  return {
    live: files.get("api/lib/api_web/live/item_list_live.ex") ?? "",
    tsx: files.get("web/src/pages/items/list.tsx") ?? "",
  };
}

/** `handle_params/3` alone — the guards must be IN the load, not merely
 *  somewhere in the module (`handle_event("loom-sort", …)` carries the same
 *  reload, so a whole-file `toContain` would pass off the wrong clause). */
function handleParams(live: string): string {
  const from = live.indexOf("def handle_params(");
  expect(from).toBeGreaterThan(-1);
  return live.slice(from, live.indexOf("\n  end", from));
}

function handleEvent(live: string, name: string): string {
  const from = live.indexOf(`def handle_event("${name}"`);
  expect(from).toBeGreaterThan(-1);
  return live.slice(from, live.indexOf("\n  end", from));
}

describe("gap 1 — each filter arm's load runs only in the arm that renders it", () => {
  it("the filtered read is guarded by its own `match` predicate", async () => {
    const params = handleParams((await scaffolded()).live);
    expect(params).toContain(`if socket.assigns.by_name_n != "" do`);
    // The guard has to WRAP the read, not sit beside it.
    expect(params).toMatch(
      /if socket\.assigns\.by_name_n != "" do\n\s+case Api\.Catalog\.by_name_item\(socket\.assigns\.by_name_n\) do/,
    );
  });

  it("the `all` fallback is guarded by the NEGATION, so it cannot overwrite the filter", async () => {
    const params = handleParams((await scaffolded()).live);
    expect(params).toMatch(
      /if not \(socket\.assigns\.by_name_n != ""\) do\n\s+case Api\.Catalog\.list_items\(/,
    );
    // The defect itself: an UNGUARDED `list_items` load, which — emitted last —
    // discarded the filtered rows the line above had just fetched.
    expect(params).not.toMatch(/socket =\n\s+case Api\.Catalog\.list_items\(/);
  });

  it("React needs no guard — each arm reads its OWN hook, which is the parity target", async () => {
    const tsx = (await scaffolded()).tsx;
    expect(tsx).toContain("const itemByName = useByNameItem({ n: byNameN });");
    expect(tsx).toContain("const itemAll = useAllItems(");
    // Two variables, so no arm can clobber the other — the property the HEEx
    // guard reproduces over one shared assign.
    expect(tsx).toContain("itemByName.data");
    expect(tsx).toContain("itemAll.data.items");
  });

  it("a page with no `match` keeps the unguarded load it always emitted", async () => {
    const files = await generateSystemFiles(UNFILTERED);
    const params = handleParams(files.get("api/lib/api_web/live/items_live.ex") ?? "");
    expect(params).toMatch(/socket =\n\s+case Api\.Catalog\.list_items\(\) do/);
    expect(params).not.toContain(" if ");
  });
});

describe("gap 2 — the assign always holds the shape the rendering arm reads", () => {
  it("each arm's markup reading is paired with the load guarded by that same arm", async () => {
    const live = (await scaffolded()).live;
    const params = handleParams(live);

    // Filtered arm: markup reads `@items` as a plain LIST; the load guarded by
    // that arm's predicate calls the find, which returns a plain list.
    expect(live).toContain(`<% @by_name_n != "" -> %>`);
    expect(live).toContain("Enum.empty?(@items)");
    expect(live).toContain("rows={@items}");
    expect(params).toMatch(
      /if socket\.assigns\.by_name_n != "" do\n\s+case Api\.Catalog\.by_name_item\(/,
    );

    // `all` arm: markup reads the paged ENVELOPE; the load guarded by the
    // negation calls the paged `list_items/4`, which returns one.
    expect(live).toContain("Enum.empty?(@items.items)");
    expect(live).toContain("rows={@items.items}");
    expect(live).toContain("total_pages={@items.totalPages}");
    expect(params).toMatch(
      /if not \(socket\.assigns\.by_name_n != ""\) do\n\s+case Api\.Catalog\.list_items\(socket\.assigns\.page_num/,
    );

    // Every markup `cond` predicate has a load guarded by the handler-position
    // spelling of the SAME predicate.  This is the pairing itself: if a future
    // change guards a load with a condition the markup does not branch on, the
    // assign can again hold a shape the rendering arm cannot read.
    for (const [, cond] of live.matchAll(/<% (@\w+ != "") -> %>/g)) {
      expect(params).toContain(`if ${cond!.replace(/^@/, "socket.assigns.")} do`);
    }
  });
});

describe("gap 3 — the filter input is bound, not a disabled stub", () => {
  it("the scaffolded filter field binds its multi-word state assign", async () => {
    const live = (await scaffolded()).live;
    expect(live).toContain(`<.input type="text" name="by_name_n" value={@by_name_n}`);
    expect(live).toContain(`phx-change="update_by_name_n"`);
    // The stub the `!stateNames.has(bind)` path used to emit for it.
    expect(live).not.toContain(`name="_unbound"`);
    // …over an assign `mount/3` really seeds, so `value={@by_name_n}` resolves.
    expect(live).toContain(`|> assign(:by_name_n, "")`);
  });

  it("it is the SNAKE-CASING that decides it — a one-word bind always worked", async () => {
    // The defect's signature: the same primitive, the same page, two binds that
    // differ only in whether the name survives `snake()` unchanged.  Before the
    // fix `q` rendered bound and `searchTerm` rendered disabled.
    const files = await generateSystemFiles(`
system BindCase {
  subdomain Retail {
    context Catalog {
      aggregate Item { name: string }
      repository Items for Item { }
    }
  }
  api CatalogApi from Retail
  ui Live {
    api Catalog: CatalogApi
    page Search {
      route: "/search"
      title: "Search"
      state { q: string = "" searchTerm: string = "" }
      body: Stack {
        Field { "Q", bind: q },
        Field { "Term", bind: searchTerm }
      }
    }
  }
  storage primary { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Catalog]
    dataSources: [catalogState]
    serves: CatalogApi
    ui: Live { Catalog: api }
    port: 4000
  }
}
`);
    const live = files.get("api/lib/api_web/live/search_live.ex") ?? "";
    expect(live).toContain(`name="q" value={@q}`);
    expect(live).toContain(`name="search_term" value={@search_term}`);
    expect(live).not.toContain(`name="_unbound"`);
  });

  it("React binds the same field — the behaviour being matched", async () => {
    expect((await scaffolded()).tsx).toContain(
      `value={byNameN} onChange={(e) => setByNameN(e.currentTarget.value)}`,
    );
  });
});

describe("typing in the box refetches — a LiveView has no query to invalidate", () => {
  it("the write-back clause re-runs the reads that depend on the assign it wrote", async () => {
    const clause = handleEvent((await scaffolded()).live, "update_by_name_n");
    // The write first, so the reload's guards read the NEW value…
    expect(clause).toContain("socket = assign(socket, :by_name_n, value)");
    // …then both guarded loads, exactly as `handle_params/3` runs them.
    expect(clause).toContain(`if socket.assigns.by_name_n != "" do`);
    expect(clause).toContain("case Api.Catalog.by_name_item(socket.assigns.by_name_n) do");
    expect(clause).toContain(`if not (socket.assigns.by_name_n != "") do`);
    expect(clause).toContain("{:noreply, socket}");
  });

  it("a bound field NO read depends on keeps its one-line write-back", async () => {
    const files = await generateSystemFiles(`
system PlainBind {
  subdomain Retail {
    context Catalog {
      aggregate Item { name: string }
      repository Items for Item { }
    }
  }
  api CatalogApi from Retail
  ui Live {
    api Catalog: CatalogApi
    page Notes {
      route: "/notes"
      title: "Notes"
      state { draftNote: string = "" }
      body: Stack { Field { "Note", bind: draftNote }, Text { draftNote } }
    }
  }
  storage primary { type: postgres }
  resource catalogState { for: Catalog, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Catalog]
    dataSources: [catalogState]
    serves: CatalogApi
    ui: Live { Catalog: api }
    port: 4000
  }
}
`);
    const clause = handleEvent(
      files.get("api/lib/api_web/live/notes_live.ex") ?? "",
      "update_draft_note",
    );
    expect(clause).toContain("{:noreply, assign(socket, :draft_note, value)}");
    expect(clause).not.toContain("case ");
  });
});
