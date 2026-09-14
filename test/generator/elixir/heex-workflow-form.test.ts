// M-T6.56 / language-docs audit F61 — `WorkflowForm { runs: W }` on LiveView.
//
// The HEEx form emitted ONE `<.input field={@form[:_placeholder]} label="Field" />`
// where React emits the workflow's real field set — and, the part that makes it
// a 500 rather than a cosmetic gap, `phx-submit="run_<wf>"` with ZERO matching
// `handle_event/3` clauses.  Pressing Submit raised `FunctionClauseError` and
// killed the LiveView.  `renderCreateEventClauses` filters
// `kind === "aggregate"`, which is exactly why the workflow binding fell
// through it silently.
//
// Three things the aggregate create path gets for free and this one must do by
// hand, each pinned below:
//
//   * the `as:` prefix (`to_form(%{}, as: "<wf>")`) — without it the inputs are
//     named bare and the params never arrive under the key the clause matches;
//   * the REKEY — the form field is `snake(param)` while the workflow module
//     destructures the DECLARED name, so a multi-word param would bind `nil`;
//   * the COERCION — a browser form submits strings, the HTTP route feeds the
//     same `run/1` typed JSON, and a workflow body uses its params directly
//     (there is no Ecto `cast` in between).
//
// Each claim is stated against the REACT emission of the same `.ddd` where React
// has a counterpart, so the assertion is "LiveView does what the other target
// does", not "LiveView emits this string".

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = `
system Shop {
  subdomain Sales {
    context Ordering {
      aggregate Order with crudish {
        ref: string
        qty: int
        total: decimal
        rush: bool
      }
      repository Orders for Order { }
      workflow PlaceOrder transactional {
        create(ref: string, qty: int, unitTotal: decimal, rush: bool) {
          let o = Order.create({ ref: ref, qty: qty, total: unitTotal, rush: rush })
        }
      }
      workflow SweepOrders {
        create() { }
      }
    }
  }
  api OrderingApi from Sales
  ui Live {
    api Ordering: OrderingApi
    page NewOrder { route: "/orders/new" title: "New" body: WorkflowForm { runs: PlaceOrder, testid: "place-order" } }
    page Sweep { route: "/orders/sweep" title: "Sweep" body: WorkflowForm { runs: SweepOrders, testid: "sweep" } }
  }
  ui Web {
    api Ordering: OrderingApi
    page NewOrder { route: "/orders/new" title: "New" body: WorkflowForm { runs: PlaceOrder, testid: "place-order" } }
  }
  storage primary { type: postgres }
  resource orderingState { for: Ordering, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Ordering]
    dataSources: [orderingState]
    serves: OrderingApi
    ui: Live { Ordering: api }
    port: 4000
  }
  deployable web { platform: react, ui: Web { Ordering: api }, targets: api, port: 3000 }
}
`;

async function emitted(): Promise<{ live: string; sweep: string; tsx: string }> {
  const files = await generateSystemFiles(SRC);
  const pick = (suffix: string): string => {
    const k = [...files.keys()].find((x) => x.endsWith(suffix));
    if (!k) throw new Error(`no file ending in ${suffix}`);
    return files.get(k)!;
  };
  const tsxKey = [...files.keys()].find(
    (k) => /web\/src\/pages\/.*\.tsx$/.test(k) && /new/i.test(k),
  );
  return {
    live: pick("live/new_order_live.ex"),
    sweep: pick("live/sweep_live.ex"),
    tsx: tsxKey ? files.get(tsxKey)! : "",
  };
}

describe("HEEx `WorkflowForm` — the real field set (F61)", () => {
  it("emits one typed `<.input>` per workflow param, not a `_placeholder`", async () => {
    const { live } = await emitted();
    expect(live).toContain(`<.input field={@form[:ref]} type="text" label="Ref"`);
    expect(live).toContain(`<.input field={@form[:qty]} type="number" label="Qty"`);
    expect(live).toContain(`<.input field={@form[:unit_total]} type="number"`);
    expect(live).toContain(`<.input field={@form[:rush]} type="checkbox" label="Rush"`);
    // The defect.
    expect(live).not.toContain("_placeholder");
  });

  it("carries the per-field testids the emitted page objects address", async () => {
    const { live } = await emitted();
    for (const f of ["ref", "qty", "unitTotal", "rush"]) {
      expect(live).toContain(`data-testid="place-order-input-${f}"`);
    }
  });

  it("React asks for the same fields — the parity target", async () => {
    const { tsx } = await emitted();
    for (const f of ["ref", "qty", "unitTotal", "rush"]) {
      expect(tsx, `react form is missing ${f}`).toContain(f);
    }
  });
});

describe("HEEx `WorkflowForm` — the `run_<wf>` handler (F61)", () => {
  it("emits a `handle_event` clause matching the form's own `phx-submit`", async () => {
    const { live } = await emitted();
    // The two spellings MUST agree — they disagreed by being absent before.
    expect(live).toContain(`phx-submit="run_place_order"`);
    expect(live).toContain(
      `def handle_event("run_place_order", %{"place_order" => raw}, socket) do`,
    );
    expect(live).toContain("case Api.Ordering.Workflows.PlaceOrder.run(params) do");
  });

  it("namespaces `@form` with the workflow's `as:`, so the params arrive under that key", async () => {
    const { live } = await emitted();
    const as = /to_form\(%\{\}, as: "([a-z_]+)"\)/.exec(live)?.[1];
    expect(as, "mount does not namespace the workflow form").toBeDefined();
    // The `as:` IS the key the handler destructures — read the handler rather
    // than restating the literal, so the two cannot drift apart.
    expect(live).toContain(`def handle_event("run_${as}", %{"${as}" => raw}, socket) do`);
  });

  it("rekeys the SNAKE form field to the DECLARED param name the workflow reads", async () => {
    const { live } = await emitted();
    // `unitTotal` is the whole point: the input is `unit_total`, the workflow
    // module destructures `%{"unitTotal" => …}`.
    expect(live).toContain(`"unitTotal" => __wf_param(Map.get(raw, "unit_total"), :decimal)`);
  });

  it("narrows each submitted string to its declared kind", async () => {
    const { live } = await emitted();
    expect(live).toContain(`"qty" => __wf_param(Map.get(raw, "qty"), :int)`);
    expect(live).toContain(`"rush" => __wf_param(Map.get(raw, "rush"), :bool)`);
    expect(live).toContain(`"ref" => __wf_param(Map.get(raw, "ref"), :string)`);
    expect(live).toContain("defp __wf_param(v, :int) when is_binary(v) do");
    expect(live).toContain("defp __wf_param(v, :bool) when is_binary(v)");
  });

  it("a param-LESS workflow binds `_raw` and emits no coercer", async () => {
    const { sweep } = await emitted();
    expect(sweep).toContain(
      `def handle_event("run_sweep_orders", %{"sweep_orders" => _raw}, socket) do`,
    );
    expect(sweep).toContain("params = %{}");
    // An emitted-but-uncalled private function fails `--warnings-as-errors`.
    expect(sweep).not.toContain("__wf_param");
  });
});
