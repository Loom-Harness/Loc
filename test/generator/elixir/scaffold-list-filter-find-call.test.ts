// ---------------------------------------------------------------------------
// Scaffolded list page × its FILTER BAR, on the LiveView leg (schemathesis
// elixir cell, finding E5).
//
// `scaffoldList` builds the list region as a `match`: one arm per bar-eligible
// repository `find` (guarded by "every input of this find is set"), falling
// back to the paged `all`.  The HEEx walker records one `QueryBinding` per arm
// and `handle_params` loads them — and it used to load them BOTH WRONG:
//
//   1. every binding called `list_<agg>s(<that arm's args>)`, whatever read the
//      arm's `of:` actually named.  A filter argument therefore landed in the
//      PAGED list's `page` slot:
//
//        case Api1.Shop.list_orders(socket.assigns.by_code_code) do
//
//      `list/4`'s first statement is `offset = (page - 1) * page_size`, so with
//      the bar's unset value that is `("" - 1) * 20` →
//      `** (ArithmeticError) bad argument in arithmetic expression:
//      :erlang.-("", 1)` — a 500 on EVERY load of the page, which is how
//      `GET /wallets` answered 500 on the elixir Schemathesis cell; and
//   2. the arms were ungated, so all of them ran on every `handle_params` and
//      the last write to `@items` silently won.  The filter bar could not work
//      even once the call was right, and the filter read ran with its own
//      UNSET value — which is what reached the repository at all.
//
// Same defect class as `scaffold-list-find-all-arity.test.ts` (a call site that
// nothing compared against its `defdelegate`), so this pins the comparison the
// same way: every emitted call site must match a delegate of that name, and the
// gates must implement the `match`'s first-match-wins.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** A scaffolded list whose repository carries ONE bar-eligible filter find. */
const ONE_FILTER = `system FilterRepro {
  subdomain D {
    context Shop {
      aggregate Order with crudish {
        code: string
        total: int
      }
      repository Orders for Order {
        find byCode(code: string): Order[] where this.code == code
      }
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

/** Two of them — the arm-ordering case: arm 2 must also exclude arm 1. */
const TWO_FILTERS = ONE_FILTER.replace(
  "        find byCode(code: string): Order[] where this.code == code\n",
  "        find byCode(code: string): Order[] where this.code == code\n" +
    "        find byTotal(total: int): Order[] where this.total == total\n",
);

const LIST_LIVE = "api1/lib/api1_web/live/order_list_live.ex";
const CONTEXT = "api1/lib/api1/shop.ex";

async function emit(src: string): Promise<{ live: string; context: string }> {
  const files = await generateSystemFiles(src);
  const live = files.get(LIST_LIVE);
  const context = files.get(CONTEXT);
  if (live === undefined) throw new Error(`${LIST_LIVE} not emitted`);
  if (context === undefined) throw new Error(`${CONTEXT} not emitted`);
  return { live, context };
}

/** `handle_params`'s body — the initial load, where the crash happened. */
function handleParams(live: string): string {
  const start = live.indexOf("def handle_params(");
  expect(start, "no handle_params/3 in the list LiveView").toBeGreaterThan(-1);
  const end = live.indexOf("{:noreply, socket}", start);
  return live.slice(start, end);
}

/** Every `<Ctx>.<fn>(<args>)` read call in a block, in file order. */
function reads(block: string): { fn: string; args: string }[] {
  return [...block.matchAll(/Api1\.Shop\.(\w+)\(([^)]*)\)/g)].map((m) => ({
    fn: m[1]!,
    args: m[2]!,
  }));
}

describe("scaffolded list filter bar — the LiveView load calls the find it named", () => {
  it("calls `<find>_<agg>` for the filter arm, not the paged `list_<agg>s`", async () => {
    const { live } = await emit(ONE_FILTER);
    const calls = reads(handleParams(live));
    expect(calls.map((c) => c.fn)).toEqual(["by_code_order", "list_orders"]);
    // The precise shape of the old crash: the filter's own state passed where
    // `list/4` reads `page`, whose first use is `(page - 1) * page_size`.
    expect(
      handleParams(live),
      'the filter\'s state reached the PAGED list read (the `:erlang.-("", 1)` crash)',
    ).not.toMatch(/list_orders\(socket\.assigns\.by_code_code/);
  });

  it("passes the filter's state to the filter read and the paging state to the paged read", async () => {
    const { live } = await emit(ONE_FILTER);
    const calls = reads(handleParams(live));
    expect(calls[0]!.args).toBe("socket.assigns.by_code_code");
    expect(calls[1]!.args).toBe(
      "socket.assigns.page_num, 10, socket.assigns.sort_key, socket.assigns.sort_dir",
    );
  });

  it("every emitted call site matches a `defdelegate` of the same name and arity", async () => {
    const { live, context } = await emit(ONE_FILTER);
    for (const call of reads(handleParams(live))) {
      const m = new RegExp(`defdelegate ${call.fn}\\(([^)]*)\\)`).exec(context);
      expect(m, `no \`defdelegate ${call.fn}(...)\` for the emitted call site`).not.toBeNull();
      const declared = m![1]!.split(",").filter((s) => s.trim() !== "");
      const required = declared.filter((p) => !p.includes("\\\\")).length;
      const passed = call.args.split(",").filter((s) => s.trim() !== "").length;
      expect(passed, `${call.fn} called with ${passed} args`).toBeGreaterThanOrEqual(required);
      expect(passed, `${call.fn} called with ${passed} args`).toBeLessThanOrEqual(declared.length);
    }
  });

  it("gates each arm's load on its own condition, so only one read runs", async () => {
    const { live } = await emit(ONE_FILTER);
    const body = handleParams(live);
    // The filter arm runs only when its input is set …
    expect(body).toMatch(
      /if \(socket\.assigns\.by_code_code != ""\) do\n\s+case Api1\.Shop\.by_code_order/,
    );
    // … and the `all` fallback only when it is NOT (the `match`'s `else`).
    expect(body).toMatch(
      /if \(!\(socket\.assigns\.by_code_code != ""\)\) do\n\s+case Api1\.Shop\.list_orders/,
    );
    // A non-matching arm leaves the assign alone — it is not an error, the
    // matching arm owns `@items`.
    expect(body).toContain("else\n        socket\n      end");
  });

  it("orders the gates first-match-wins — arm 2 excludes arm 1", async () => {
    const { live } = await emit(TWO_FILTERS);
    const body = handleParams(live);
    const calls = reads(body);
    expect(calls.map((c) => c.fn)).toEqual(["by_code_order", "by_total_order", "list_orders"]);
    // Arm 2's gate negates arm 1 before asserting its own condition …
    expect(body).toMatch(
      /if \(!\(socket\.assigns\.by_code_code != ""\)\) && \(socket\.assigns\.by_total_total != 0\) do\n\s+case Api1\.Shop\.by_total_order/,
    );
    // … and the fallback negates both.
    expect(body).toMatch(
      /if \(!\(socket\.assigns\.by_code_code != ""\)\) && \(!\(socket\.assigns\.by_total_total != 0\)\) do\n\s+case Api1\.Shop\.list_orders/,
    );
  });

  it("leaves an unfiltered list page byte-identical (no gate, no rename)", async () => {
    const { live } = await emit(
      ONE_FILTER.replace(
        "        find byCode(code: string): Order[] where this.code == code\n",
        "",
      ),
    );
    const body = handleParams(live);
    expect(reads(body).map((c) => c.fn)).toEqual(["list_orders"]);
    expect(body).not.toContain("if (");
  });
});
