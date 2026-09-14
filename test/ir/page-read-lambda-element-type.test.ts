// `queryview-lambda-int-plus-literal-concat` (targets-completeness ledger, P2)
// — a page-body read's lambda binding must carry the RECORD type, not the
// `string` placeholder.
//
// A page-body read (`Sales.Order.byId(id)`) is headed by a ui-local
// `api <handle>: <Api>` alias, which links to nothing, so the whole chain
// lowers to an untyped `method-call`.  The `data:` lambda therefore bound its
// parameter at the bare-lambda `string` placeholder, every member read off it
// typed `string` too, and `binaryResultType` selected IMPLICIT STRING
// CONCATENATION for `o.qty + 1`:
//
//     Text { string(o.qty + 1) }   →   String((orderById.data.qty + String(1)))
//
// i.e. `"51"` for qty=5 — silently wrong on the four JS frontends and a hard
// build break on Feliz/Flutter, where `int + string` does not compile.  The
// same arithmetic over a component PARAM (a declared type) was always correct,
// which is what made this look like an operator bug rather than a binding one.
//
// Two facts had to change for the binding to resolve:
//   1. the read's result type is recovered from the aggregate the chain names
//      (`ofReadResultType` in lower-expr.ts), and
//   2. the project-global ambient entity index actually indexes aggregates
//      declared under a `subdomain` — its recursion walked `members` only, and
//      a Subdomain's children hang off `contexts`, so the index was EMPTY for
//      the overwhelmingly common layout.
//
// Mutation proof: drop either half and the arithmetic cases below fail on
// `expected '…qty + String(1)…' to contain '…qty + 1…'`.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

function system(pageBody: string, extraFinds = ""): string {
  return `
    system Demo {
      subdomain Sales {
        context Sales {
          aggregate Order {
            qty: int
            label: string
          }
          repository Orders for Order {
            find byId(id: Order id): Order?
            ${extraFinds}
          }
        }
      }
      api SalesApi from Sales
      ui Web {
        api Sales: SalesApi
        page Detail {
          route: "/o/:id"
          ${pageBody}
        }
        page Home { route: "/" body: Heading { "home", level: 1 } }
      }
      storage primary { type: postgres }
      resource salesState { for: Sales, kind: state, use: primary }
      deployable api {
        platform: node
        contexts: [Sales]
        dataSources: [salesState]
        serves: SalesApi
        port: 3000
      }
      deployable webApp { platform: react, targets: api, ui: Web { Sales: api }, port: 3001 }
    }
  `;
}

async function detailTsx(pageBody: string, extraFinds = ""): Promise<string> {
  return (await generateSystemFiles(system(pageBody, extraFinds))).get(
    "web_app/src/pages/detail.tsx",
  )!;
}

const SINGLE_BODY = `
  body: QueryView {
    of: Sales.Order.byId(id),
    single: true,
    loading: Loader {},
    empty: Empty { "none" },
    data: o => Stack {
      Text { string(o.qty + 1) },
      Text { string(1 + o.qty) },
      Text { string(o.qty * 2) },
      Text { o.label }
    }}`;

describe("page-body read lambda binding carries the record type", () => {
  it("keeps `<int member> + <int literal>` as arithmetic, not concatenation", async () => {
    const tsx = await detailTsx(SINGLE_BODY);
    expect(tsx).toContain("String((orderById.data.qty + 1))");
    expect(tsx).toContain("String((1 + orderById.data.qty))");
    // The literal is never wrapped in a stringify — that wrap IS the defect.
    expect(tsx).not.toContain("String(1)");
  });

  it("leaves the already-correct neighbours byte-for-byte alone", async () => {
    const tsx = await detailTsx(SINGLE_BODY);
    // `*` never selected concat, and a genuinely string-typed member still
    // renders as a bare read.
    expect(tsx).toContain("String((orderById.data.qty * 2))");
    expect(tsx).toContain("{orderById.data.label}");
  });

  it("types a `string` member's concat as a concat (the rule still applies)", async () => {
    const tsx = await detailTsx(`
      body: QueryView {
        of: Sales.Order.byId(id),
        single: true,
        loading: Loader {},
        empty: Empty { "none" },
        data: o => Text { o.label + 1 }}`);
    // `label: string` — the implicit `string + X` rule is correct here, so the
    // literal DOES get the stringify wrap.  This is what separates the fix from
    // "stop wrapping literals".
    expect(tsx).toContain("orderById.data.label + String(1)");
  });

  it("threads the element type through `For { each: rows, o => … }`", async () => {
    const tsx = await detailTsx(
      `
      body: QueryView {
        of: Sales.Order.recent(),
        loading: Loader {},
        empty: Empty { "none" },
        data: rows => For { each: rows, o => Text { string(o.qty + 1) } }}`,
      "find recent(): Order[]",
    );
    expect(tsx).toContain("String((o.qty + 1))");
    expect(tsx).not.toContain("String(1)");
  });

  it("binds the list read as an ARRAY, so the row binding is the element", async () => {
    // `data:` over a non-`single:` read binds the whole collection — a member
    // read straight off it would be nonsense, and `For`'s lambda is what takes
    // the element.  Pinning both in one fixture keeps the two apart.
    const tsx = await detailTsx(
      `
      body: QueryView {
        of: Sales.Order.recent(),
        loading: Loader {},
        empty: Empty { "none" },
        data: rows => Table { rows: rows, Column { field: "qty" } }}`,
      "find recent(): Order[]",
    );
    expect(tsx).toContain("orderRecent.data");
  });
});
