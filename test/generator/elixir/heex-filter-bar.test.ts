// The scaffolded list page's filter bar FILTERS on Phoenix LiveView.
//
// Audit P10 named three independent gaps, each alone enough to make the bar
// decorative.  TWO OF THEM LANDED ON `main` INDEPENDENTLY, in the E5 fix
// (`scaffold-list-filter-find-call.test.ts`), and are NOT re-landed here:
//
//   (a) the load block was unguarded — every arm's read ran, in body order, all
//       writing `:items`, so the `all` fallback overwrote the filtered arm's
//       rows.  `QueryBinding.gate` / `WalkContext.matchGate` close it, and
//       `scaffold-list-filter-find-call.test.ts` pins the gates, their
//       first-match-wins ordering and the ungated control.
//   (b) the two arms disagreed on shape — the filtered arm reads `@items` as a
//       plain list, the `all` arm as the paged envelope.  Each reading is right
//       FOR ITS ARM; (a) is what makes exactly one load run, so the assign now
//       always holds what the rendering arm reads.  Settled by (a), not here.
//
// What is left — and what this file covers:
//
//   (c) THE INPUT WAS INERT.  `controlledInput` tested `ctx.stateNames.has(bind)`
//       with `bind` in the `.ddd`'s camelCase spelling against a set keyed by
//       the SNAKE-CASED assign name.  That membership test can only succeed for
//       a one-word field, so every multi-word bound input fell through to the
//       `name="_unbound" … disabled` stub — and a scaffolded filter field is
//       `<find><Param>` by construction, never one word.  The backing assign sat
//       in `mount/3`, unread.  With (a) and (b) fixed and this one not, the bar
//       loads the right rows for a value the user cannot type.
//
//   (d) NOTHING REFETCHED.  A LiveView has no `useQuery` to invalidate and
//       `handle_params/3` does not re-run on an assign, so the input's
//       write-back clause must itself re-run the reads that depend on the
//       assign it just wrote.  Without it, typing flips the render `cond` into
//       the filtered arm while `@items` still holds the `all` arm's envelope —
//       (b) again, at runtime, from the other side.
//
//   (e) A GATE THAT CANNOT BE RE-RENDERED IN A HANDLER IS REFUSED.  (a)'s gate
//       is the arm predicate rendered for handler position, but an arm
//       condition is written for the RENDER scope: a `For` lambda's binding
//       does not exist in `handle_params/3`, so the gate emitted a bare
//       variable and `mix compile` rejected the whole project.
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

async function scaffolded(): Promise<{ live: string; tsx: string }> {
  const files = await generateSystemFiles(SYS);
  return {
    live: files.get("api/lib/api_web/live/item_list_live.ex") ?? "",
    tsx: files.get("web/src/pages/items/list.tsx") ?? "",
  };
}

/** `handle_params/3` alone — a claim about the LOAD must be read there, not
 *  merely somewhere in the module (`handle_event("loom-sort", …)` carries the
 *  same reload, so a whole-file `toContain` would pass off the wrong clause). */
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

describe("gap (c) — the filter input is bound, not a disabled stub", () => {
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

describe("gap (d) — typing in the box refetches; a LiveView has no query to invalidate", () => {
  it("the write-back clause re-runs the reads that depend on the assign it wrote", async () => {
    const clause = handleEvent((await scaffolded()).live, "update_by_name_n");
    // The write first, so the reload's gates read the NEW value…
    expect(clause).toContain("socket = assign(socket, :by_name_n, value)");
    // …then both gated loads, exactly as `handle_params/3` runs them.
    expect(clause).toContain(`if (socket.assigns.by_name_n != "") do`);
    expect(clause).toContain("case Api.Catalog.by_name_item(socket.assigns.by_name_n) do");
    expect(clause).toContain(`if (!(socket.assigns.by_name_n != "")) do`);
    expect(clause).toContain("{:noreply, socket}");
  });

  it("the reload is the SAME block handle_params runs — the paths cannot diverge", async () => {
    const live = (await scaffolded()).live;
    const reads = (s: string) =>
      [...s.matchAll(/case Api\.Catalog\.(\w+)\(([^)]*)\) do/g)].map((m) => `${m[1]}(${m[2]})`);
    expect(reads(handleEvent(live, "update_by_name_n"))).toEqual(reads(handleParams(live)));
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

describe("gap (e) — a gate is only carried down when it can be re-rendered in a handler", () => {
  it("a `match` on a LAMBDA parameter stays ungated rather than emitting a bare variable", async () => {
    // `handle_params/3` is a function body, not the render scope: the `i` bound
    // by the `For` lambda does not exist there.  Gating the inner read with
    // `if (i.flagged) do` emits an undefined variable and fails `mix compile` —
    // a whole-project failure, not a bad render.  So the gate is refused and
    // the load keeps the exact statement it always emitted.
    const files = await generateSystemFiles(`
system LambdaGate {
  subdomain Retail {
    context Catalog {
      aggregate Item {
        name: string
        flagged: bool
      }
      repository Items for Item { }
    }
  }
  api CatalogApi from Retail
  ui Live {
    api Catalog: CatalogApi
    page Board {
      route: "/board"
      title: "Board"
      body: QueryView {
        of: Catalog.Item.all,
        data: rows => Stack {
          For {
            each: rows,
            i => match {
              i.flagged => QueryView {
                of: Catalog.Item.all,
                data: inner => Text { "flagged" }
              },
              else => Text { i.name }
            }
          }
        }
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
    const params = handleParams(files.get("api/lib/api_web/live/board_live.ex") ?? "");
    // Both reads, ungated — byte-identical to the pre-gate emit.
    expect(params).toMatch(
      /socket =\n\s+case Api\.Catalog\.list_items\(\) do\n\s+\{:ok, items\} -> assign\(socket, :inner, items\)/,
    );
    expect(params).toMatch(
      /socket =\n\s+case Api\.Catalog\.list_items\(\) do\n\s+\{:ok, items\} -> assign\(socket, :items, items\)/,
    );
    // …and, the point: no lambda binding leaked into the function body.
    expect(params).not.toContain("if (i.");
    expect(params).not.toMatch(/\bi\.flagged\b/);
  });
});
