// Two `QueryView`s on one LiveView page each load into their own assign.
//
// The assign a read loads into is named after its `data:` lambda param (`rows`
// reads as `items`).  Two reads whose lambdas share the param used to load
// into ONE assign: both `handle_params` loads wrote `:items`, both ladders
// read `@items`, and the second load overwrote the first, so the Customers
// table showed Orders.
//
// Why emitted text: the booted LiveView tiers drive scaffolded pages only (the
// `test e2e` DSL creates and reads records through the scaffold's page
// objects), so a hand-written page carrying two reads is out of their reach.
// What is pinned is the WIRING — which assign each load fills and which assign
// each ladder reads — collected structurally rather than by substring.
// `vanilla-control-flow.ddd` carries the same page through `mix compile`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SYSTEM = `
system TwoReads {
  subdomain Core {
    context Shop {
      aggregate Customer with crudish { name: string  derived display: string = name }
      aggregate Order with crudish { code: string  derived display: string = code }
      repository Customers for Customer { }
      repository Orders for Order { }
    }
  }
  api ShopApi from Core
  ui Web {
    api S: ShopApi
    page Both {
      route: "/both"
      title: "Both"
      body: Stack {
        QueryView {
          of: S.Customer.all,
          data: rows => Table { rows: rows, Column { "Name", c => Text { c.name } } }
        },
        QueryView {
          of: S.Order.all,
          data: rows => Table { rows: rows, Column { "Code", o => Text { o.code } } }
        }
      }
    }
  }
  storage primary { type: postgres }
  resource s { for: Shop, kind: state, use: primary }
  deployable app {
    platform: elixir
    contexts: [Shop]
    dataSources: [s]
    serves: ShopApi
    ui: Web { S: app }
    port: 4000
  }
}
`;

/** `function -> assign` for every successful load (the page reloads from
 *  more than one callback, so the same pair recurs). */
function loads(live: string): Set<string> {
  const re = /case \S+\.(list_\w+)\([^)]*\) do\n\s*\{:ok, \w+\} -> assign\(socket, :(\w+),/g;
  return new Set([...live.matchAll(re)].map((m) => `${m[1]} -> ${m[2]}`));
}

/** The assign each ladder tests for "still loading". */
function ladders(live: string): string[] {
  return [...live.matchAll(/<% is_nil\(@(\w+)\) -> %>/g)].map((m) => m[1]!);
}

describe("HEEx: two QueryViews with the same data param", () => {
  it("each read loads into, and its ladder reads, its own assign", async () => {
    const files = await generateSystemFiles(SYSTEM);
    const live = files.get("app/lib/app_web/live/both_live.ex") ?? "";
    expect(loads(live)).toEqual(new Set(["list_customers -> items", "list_orders -> items_2"]));
    expect(ladders(live)).toEqual(["items", "items_2"]);
  });
});
