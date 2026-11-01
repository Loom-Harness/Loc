// ---------------------------------------------------------------------------
// Scaffolded list page × the aggregate's `all` read shape (M-T6.40).
//
// The scaffold's server-paged list body calls `all(pageNum, 10, sortKey,
// sortDir)` and unwraps `.items`.  Whether that's right is a property of the
// aggregate's `all` READ: a plain relational aggregate's `all` is the paged
// envelope, while a `shape: document` aggregate's is a bare `T[]`
// (`ensureFindAll`, src/ir/enrich/enrichments.ts).  A scaffold that asked the
// wrong question produced:
//
//   defdelegate list_orders(), to: …OrderRepository, as: :list          # 0-arity
//   case Api1.Shop.list_orders(socket.assigns.page_num, 10, …) do        # /4
//
// `mix compile --warnings-as-errors` fails on `undefined function
// list_orders/4` — a SILENT gap: nothing in the pipeline compared the call site
// against the delegate.  These tests do exactly that comparison, on both sides
// of the fact:
//
//   * unpaged `T[]` (document) → bare `list_orders()`  == bare defdelegate
//   * paged (relational)       → 4-arg call            == 4-arg defdelegate
//
// The derivation lives at the macro layer, so this is not an Elixir-only bug —
// the react leg is pinned here too (`useAllOrders()` was emitted 0-param and
// called with four arguments).  It lives under generator/elixir because Elixir
// is where it is a hard COMPILE failure rather than a type error.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** The repro system, parametrized on the aggregate's persistence shape. */
const elixirSystem = (shape: string) => `system ArityRepro {
  subdomain D {
    context Shop {
      aggregate Order${shape} with crudish {
        code: string
        total: int
      }
      repository Orders for Order
    }
  }
  api A from D
  ui Web with scaffold(aggregates: [Order]) {
    api Shop: A
  }
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable api1 {
    platform: elixir, contexts: [Shop], dataSources: [st], serves: A,
    ui: Web { Shop: api1 }, port: 8081
  }
}`;

const DOCUMENT = " shape: document,";

const CONTEXT = "api1/lib/api1/shop.ex";
const LIST_LIVE = "api1/lib/api1_web/live/order_list_live.ex";

/** Every `list_orders(...)` call site's argument list, in file order. */
function callArgs(source: string): string[] {
  return [...source.matchAll(/Api1\.Shop\.list_orders\(([^)]*)\)/g)].map((m) => m[1]!);
}

/** The `defdelegate list_orders(<params>)` parameter list. */
function delegateParams(context: string): string {
  const m = /defdelegate list_orders\(([^)]*)\)/.exec(context);
  expect(m, "no `defdelegate list_orders(...)` in the context module").not.toBeNull();
  return m![1]!;
}

/** Arity of a comma-separated Elixir parameter/argument list. */
const arity = (list: string): number => (list.trim() === "" ? 0 : list.split(",").length);

describe("elixir — scaffolded list call arity == context delegate arity (M-T6.40)", () => {
  it("an unpaged `all` (document) gets a bare call, matching the bare delegate", async () => {
    const files = await generateSystemFiles(elixirSystem(DOCUMENT));
    const params = delegateParams(files.get(CONTEXT)!);
    const calls = callArgs(files.get(LIST_LIVE)!);
    // The page really does read the list — an empty match set would make the
    // arity comparison below vacuous.
    expect(calls.length).toBeGreaterThan(0);
    expect(arity(params)).toBe(0);
    for (const a of calls) expect(arity(a)).toBe(0);
    // …and the page must not try to unwrap a paged envelope off a bare list.
    expect(files.get(LIST_LIVE)).not.toContain(".items");
  });

  it("the paged `all` (relational) keeps the 4-arg call, matching the 4-arg delegate", async () => {
    const files = await generateSystemFiles(elixirSystem(""));
    const params = delegateParams(files.get(CONTEXT)!);
    const calls = callArgs(files.get(LIST_LIVE)!);
    expect(calls.length).toBeGreaterThan(0);
    expect(arity(params)).toBe(4);
    for (const a of calls) expect(arity(a)).toBe(4);
    expect(calls[0]).toContain("socket.assigns.page_num");
  });
});

// The same derivation, seen from the JSX side — the macro layer is shared, so a
// wrong answer is a wrong answer on every frontend.  Pinned here beside the
// Elixir cases so a future "fix" that only patches the LiveView emitter can't
// look complete.
const reactSystem = (shape: string) => `system ArityReproNode {
  subdomain D {
    context Shop {
      aggregate Order${shape} with crudish {
        code: string
        total: int
      }
      repository Orders for Order
    }
  }
  api A from D
  ui Web with scaffold(aggregates: [Order]) {
    api Shop: A
  }
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable api1 { platform: node, contexts: [Shop], dataSources: [st], serves: A, port: 8081 }
  deployable web { platform: react, ui: Web { Shop: api1 }, targets: api1, port: 3000 }
}`;

describe("react — scaffolded list hook arity == generated hook signature (M-T6.40)", () => {
  it("an unpaged `all` (document) calls the 0-param hook with no arguments", async () => {
    const files = await generateSystemFiles(reactSystem(DOCUMENT));
    // `export function useAllOrders(<params>)` — the client the page imports.
    const sig = /export function useAllOrders\(([^)]*)\)/.exec(files.get("web/src/api/order.ts")!);
    expect(sig).not.toBeNull();
    expect(arity(sig![1]!)).toBe(0);
    // `tsc --noEmit` rejects "Expected 0 arguments, but got 4".
    expect(files.get("web/src/pages/orders/list.tsx")).toContain("useAllOrders()");
  });

  it("the paged `all` (relational) passes the page/sort state to its query-object hook", async () => {
    const files = await generateSystemFiles(reactSystem(""));
    const sig = /export function useAllOrders\(([^)]*)\)/.exec(files.get("web/src/api/order.ts")!);
    expect(sig).not.toBeNull();
    expect(sig![1]).toContain("AllQueryInput");
    expect(files.get("web/src/pages/orders/list.tsx")).toContain(
      "useAllOrders({ page: pageNum, pageSize: 10, sort: sortKey, dir: sortDir })",
    );
  });
});
