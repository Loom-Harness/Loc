// ---------------------------------------------------------------------------
// F-024 / ledger F2-CFE-3 (feliz + flutter halves) — a `For` that SPLICES a
// list may only do so where the slot IS a list.
//
// `For { each: …, x => … }` lowers to a splice on the two expression targets:
// `yield!` (F#) and `...` (Dart).  Both are legal ONLY inside a list literal —
// F# reports FS0747 for a `yield!` outside a list/array/sequence expression,
// and a Dart spread outside a collection literal does not parse at all.  A
// `QueryView { of: X.all, data: rows => For { … } }` — the canonical
// hand-written list body — puts the `For` in a single-expression VALUE slot, so
// the generated app failed to build while `ddd parse` reported
// `0 error(s), 0 warning(s)`: the SILENT class.
//
// The walker now says which slot a child lands in (`ChildSlot`), and each
// target answers for itself.  These are end-to-end gates on purpose: a unit
// test on `renderForEach` would prove the target obeys the flag but not that
// the WALKER sets it, which is the half that was missing.
//
// The children-slot legs are the other side of the ratchet — a `For` inside a
// `Stack` must keep splicing, or the fix would have traded a compile error for
// a pointless wrapper on every list on the page.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

/** One page body, one frontend platform. */
function sys(platform: "feliz" | "flutter", body: string): string {
  return `
    system Shop {
      subdomain Sales {
        context Orders {
          aggregate Order { code: string }
          repository Orders for Order { }
        }
      }
      api SalesApi from Sales
      storage pg { type: postgres }
      resource ordersState { for: Orders, kind: state, use: pg }
      ui WebApp {
        framework: ${platform}
        api Sales: SalesApi
        page Listing {
          route: "/orders"
          state { flag: bool = true }
          body: ${body}
        }
      }
      deployable api { platform: node contexts: [Orders] dataSources: [ordersState] serves: SalesApi port: 8080 }
      deployable web { platform: ${platform} targets: api ui: WebApp { Sales: api } port: 3000 }
    }
  `;
}

const ITEM = `For { each: rows, o => Text { o.code } }`;

async function emitted(platform: "feliz" | "flutter", body: string): Promise<string> {
  const files = await generateSystemFiles(sys(platform, body));
  const suffix = platform === "feliz" ? "src/App.fs" : "lib/pages/listing_page.dart";
  const hit = [...files].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no ${suffix} emitted; got ${[...files.keys()].join(", ")}`);
  return hit[1];
}

describe("feliz: `For` splices only into a list slot", () => {
  it("a `QueryView` `data:` lambda body takes ONE element, not a `yield!`", async () => {
    const fs = await emitted("feliz", `QueryView { of: Sales.Order.all, data: rows => ${ITEM} }`);
    expect(fs).toContain("React.fragment (allOrders |> List.map (fun o ->");
    // The only `For` in this page is the one in the lambda, so a `yield!`
    // anywhere in the emitted app is the FS0747 shape coming back.
    expect(fs).not.toContain("yield!");
  });

  it("a ternary branch takes ONE element, not a `yield!`", async () => {
    const fs = await emitted(
      "feliz",
      `QueryView { of: Sales.Order.all, data: rows => flag ? ${ITEM} : Text { "off" } }`,
    );
    expect(fs).toContain("React.fragment (allOrders |> List.map (fun o ->");
    expect(fs).not.toContain("yield!");
  });

  it("a `match` arm takes ONE element, not a `yield!`", async () => {
    const fs = await emitted(
      "feliz",
      `QueryView { of: Sales.Order.all, data: rows => match {
         flag == true => ${ITEM}
         else => Text { "off" }
       } }`,
    );
    expect(fs).toContain("React.fragment (allOrders |> List.map (fun o ->");
    expect(fs).not.toContain("yield!");
  });

  it("still splices into a children SEQUENCE (`Stack { For { … } }`)", async () => {
    const fs = await emitted(
      "feliz",
      `QueryView { of: Sales.Order.all, data: rows => Stack { ${ITEM} } }`,
    );
    expect(fs).toContain("yield! allOrders |> List.map (fun o ->");
  });
});

describe("flutter: `For` spreads only into a collection literal", () => {
  it("a `QueryView` `data:` lambda body takes ONE widget, not a bare `...` spread", async () => {
    const dart = await emitted(
      "flutter",
      `QueryView { of: Sales.Order.all, data: rows => ${ITEM} }`,
    );
    // The spread survives — inside the list literal the `Column` opens.
    expect(dart).toMatch(
      /Column\(crossAxisAlignment: CrossAxisAlignment\.start, children: <Widget>\[\.\.\.orderAll\.items\.map/,
    );
    // …and no lambda/branch returns the spread naked.
    expect(dart).not.toMatch(/=>\s*\.\.\./);
  });

  it("still spreads into a children SEQUENCE (`Stack { For { … } }`)", async () => {
    const dart = await emitted(
      "flutter",
      `QueryView { of: Sales.Order.all, data: rows => Stack { ${ITEM} } }`,
    );
    expect(dart).toMatch(/\.\.\.orderAll\.items\.map\(\(o\) =>/);
  });
});
