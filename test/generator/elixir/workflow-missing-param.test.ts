// A workflow request that omits a param the body uses answered 500 on Phoenix,
// on a route whose own OpenAPI declares 422 and where node/dotnet/java/python
// all validate.
//
// The cause was a BARE MATCH.  `run/1` surfaced the referenced create-params as
// locals with
//
//     %{"name" => name, "qty" => qty} = params
//
// which RAISES `MatchError` on a missing key rather than returning — so it
// never reached the controller's `{:error, _}` arms and the fault handler
// answered a sanitized 500.  Found while boot-verifying the F-030 workflow
// contract fix; the two are the same family (Phoenix disagreeing with its own
// published contract), one at the success rung and one at the failure rung.
//
// The fix is a guard on the public `run/1` plus a fallback clause, chosen
// because it leaves the body and its indentation untouched: everything that
// used to reach the destructure still does, and everything that would have
// raised now returns a term the controller maps.
//
// Scoped to the params the body DESTRUCTURES, which is exactly the set that
// could raise.  A declared-but-unreferenced param is deliberately not required
// here — refusing it would be a new rejection this defect does not call for.

import { beforeAll, describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const sys = (workflow: string) => `
system WF {
  subdomain S {
    context C {
      aggregate Order with crudish {
        name: string
        qty: int
      }
      repository Orders for Order { }
      ${workflow}
    }
  }
  api CApi from S
  storage primary { type: postgres }
  resource cs { for: C, kind: state, use: primary }
  deployable e {
    platform: elixir
    contexts: [C]
    dataSources: [cs]
    serves: CApi
    port: 4000
  }
}
`;

const WITH_PARAMS = `workflow placeOrder {
        create(name: string, qty: int) {
          let o = Order.create({ name: name, qty: qty })
        }
      }`;

// No params at all — the negative that keeps the change strictly additive.
const NO_PARAMS = `workflow sweepOrders {
        create() {
          let o = Order.create({ name: "auto", qty: 1 })
        }
      }`;

async function elixirFile(source: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(source);
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key as string) as string;
}

describe("a workflow request missing a referenced param", () => {
  let wf = "";
  let ctl = "";
  beforeAll(async () => {
    wf = await elixirFile(sys(WITH_PARAMS), "/workflows/place_order.ex");
    ctl = await elixirFile(sys(WITH_PARAMS), "/controllers/workflows_controller.ex");
  });

  it("guards the public run/1 on every param the body destructures", () => {
    expect(wf).toContain(
      'def run(params) when is_map(params) and is_map_key(params, "name") and is_map_key(params, "qty") do',
    );
  });

  it("RETURNS the refusal rather than raising, so the controller can map it", () => {
    expect(wf).toMatch(
      /def run\(params\) when is_map\(params\) do\n\s*\{:error, \{:invalid_params,/,
    );
    expect(wf).toContain('Enum.reject(["name", "qty"], &is_map_key(params, &1))');
  });

  it("still destructures in the guarded clause — the body is untouched", () => {
    expect(wf).toContain('%{"name" => name, "qty" => qty} = params');
  });

  it("maps the refusal to the 422 the route publishes", () => {
    expect(ctl).toContain("def respond(conn, {:error, {:invalid_params, missing}})");
    expect(ctl).toContain("422");
    // The detail names WHICH parameter is missing — the whole point of
    // returning the list rather than a bare atom.
    expect(ctl).toContain('"missing required parameter(s): " <> Enum.join(missing, ", ")');
  });

  it("the 422 arm sits ahead of the sanitized catch-all", () => {
    const arm = ctl.indexOf("{:error, {:invalid_params, missing}}");
    const catchAll = ctl.indexOf("def respond(conn, {:error, _reason})");
    expect(arm).toBeGreaterThan(-1);
    expect(catchAll).toBeGreaterThan(arm);
  });

  it("leaves a param-free workflow exactly as it was", async () => {
    // Strict additivity: no params means nothing can raise, so no guard and no
    // fallback clause — a second `run/1` head there would be dead code.
    const bare = await elixirFile(sys(NO_PARAMS), "/workflows/sweep_orders.ex");
    expect(bare).toContain("def run(params) when is_map(params) do");
    expect(bare).not.toContain("is_map_key");
    expect(bare).not.toContain("invalid_params");
  });

  it("does not add the arm to a controller that cannot produce the term", async () => {
    // Only the workflows dispatcher can answer `{:invalid_params, _}`; an arm
    // in the per-aggregate controller would be a clause a reader must disprove.
    const agg = await elixirFile(sys(WITH_PARAMS), "/controllers/order_controller.ex");
    expect(agg).not.toContain("invalid_params");
  });
});
