// The one-level `api.<name>(…)` call shape, refused rather than mis-emitted.
//
// Every call the e2e harness can address is TWO-level — the emitter's
// `matchApiCall` (`src/system/e2e-render.ts`) requires
// `api.<slug>.<method>(…)` and returns null for anything else. The validator's
// `checkMagicCall` mirrored that match exactly, including its silent
// early-return, so a one-level call validated with **0 errors** and was then
// rendered as an ordinary expression against a bare `api` identifier the
// emitted file never binds.
//
// Two failure modes, both silent before this gate:
//   * `api.echo({ text: "x" })`      → `api is not defined` at run time.
//   * `api.sum({ a: 2, b: 3 })`      → MIS-COMPILED. `sum` collides with the
//     collection intrinsic, so it lowered to a fold —
//     `(api).reduce((__acc, __x) => __acc + __num((({ a: 2, b: 3 }))(__x)), 0)`
//     — which is valid JS that means something else entirely.
//
// The shape that reaches for this form is an explicit `route … -> <Handler>`
// route, which the harness genuinely cannot address (handler routes are
// api-level; the slug sets are aggregate-, projection- and workflow-derived).
// That capability gap is tracked separately — this test pins that the gap is
// an HONEST refusal and not a silent miscompile.

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { toLoomModel } from "../_helpers/ir.js";
import { parseString } from "../_helpers/parse.js";

const sys = (body: string) => `
  system S {
    subdomain D {
      context Sales {
        aggregate Order with crudish { code: string }
        commandHandler Echo(text: string): string { return text }
      }
    }
    api A from D {
      route POST "/echo/{text}" -> Sales.Echo
    }
    storage pg { type: postgres }
    resource st { for: Sales, kind: state, use: pg }
    deployable d {
      platform: node
      contexts: [Sales]
      dataSources: [st]
      serves: A
      port: 4000
    }
    test e2e "t" against d {
      ${body}
    }
  }
`;

async function errorsFor(body: string): Promise<string[]> {
  const { model, errors } = await parseString(sys(body));
  expect(errors).toEqual([]);
  return (
    validateLoomModel(toLoomModel(model))
      .filter((d) => d.severity === "error")
      // A diagnostic with no `code` is surfaced rather than dropped: filtering
      // undefined away would let an uncoded error silently satisfy a
      // `toEqual([])` assertion below.
      .map((d) => d.code ?? "<uncoded>")
  );
}

describe("e2e — the one-level `api.<name>(…)` shape is refused", () => {
  it("refuses a call that resolves to nothing (would emit an unbound `api`)", async () => {
    expect(await errorsFor(`api.echo({ text: "hi" })`)).toContain("loom.e2e-unaddressable-call");
  });

  it("refuses a call whose name collides with a collection intrinsic", async () => {
    // The dangerous one: without the gate this lowers to a `.reduce(...)` fold
    // instead of a call, so the emitted test is wrong rather than merely broken.
    expect(await errorsFor(`api.sum({ a: 1, b: 2 })`)).toContain("loom.e2e-unaddressable-call");
  });

  it("leaves the supported two-level shapes alone (control)", async () => {
    // Without a control, a gate that refused EVERY api call would pass the two
    // assertions above.
    expect(await errorsFor(`let o = api.orders.create({ code: "c" })`)).toEqual([]);
  });
});
