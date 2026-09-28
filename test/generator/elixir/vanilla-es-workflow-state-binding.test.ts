// ---------------------------------------------------------------------------
// Vanilla Elixir — the ES-workflow handler's FOLD-SNAPSHOT binding.
//
// `renderEsWorkflowHandler` binds the folded workflow snapshot as `state` when
// the handler body reads workflow state and as `_state` when it does not — the
// underscore is what keeps `mix compile` free of an unused-variable warning on
// an emit-only handler.  The decision comes from `bodyUsesState`, and wave CR1
// packet CR1-e found that predicate hand-rolling its own child enumeration over
// BOTH IR unions, short on both:
//
//   * statements — four of the fourteen `WorkflowStmtIR` kinds, with no
//     `for-each` / `if-let` nesting at all;
//   * expressions — no arm for `convert`, `match`, `list`, `duration`,
//     `i18nFormat`, a `call`'s `style:` entries, or a block-bodied lambda.
//
// (A `match` expression does not parse in a workflow `precondition` on this
// grammar, so the two probes below are `convert` and `list` — both were missing
// arms, and both are reachable there.)
//
// A state read in any of those slots answered FALSE, and the emitted module then
// bound `_state = …` on one line and named `state.<field>` on the next —
// `** (CompileError) undefined variable "state"`.  Measured on the repro below
// before the fix; the fix rides `walkWorkflowStmtExprsDeep`.
//
// The assertions distinguish a BINDING from a USE deliberately: the broken
// output still contains the string `state` (as `_state`, and in `state.paid`), so
// a plain `toContain("state")` passes on it.  Each case requires the exact
// `state = <Fold>.from_events(` construction AND the absence of the `_state`
// form, and the last case re-derives the condition name-independently.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** An ES workflow whose `on(...)` handler reads the folded `paid` field through
 *  `slot` — an expression shape the hand-rolled walk did not descend into. */
function sys(slot: string): string {
  return `system FulfillmentSys {
  subdomain Fulfillment {
    context Fulfillment {
      event OrderPlaced { order: Order id, at: datetime }
      event PaymentRegistered { order: Order id, amount: int }
      event FulfillmentCancelled { order: Order id }
      aggregate Order {
        status: string
        create() { }
      }
      repository Orders for Order { }
      channel Lifecycle { carries: OrderPlaced, PaymentRegistered, FulfillmentCancelled  delivery: broadcast  retention: ephemeral }
      workflow OrderFulfillment eventSourced {
        orderId: Order id
        paid: int
        cancelled: bool
        create(p: OrderPlaced) by p.order { emit PaymentRegistered { order: p.order, amount: 0 } }
        on(pr: PaymentRegistered) by pr.order { precondition ${slot}  emit FulfillmentCancelled { order: pr.order } }
        apply(pr: PaymentRegistered) { paid := paid + pr.amount }
        apply(fc: FulfillmentCancelled) { cancelled := true }
      }
    }
  }
  api FulfillmentApi from Fulfillment
  storage pg { type: postgres }
  resource fulfillmentState { for: Fulfillment, kind: state, use: pg }
  deployable api {
    platform: elixir
    contexts: [Fulfillment]
    dataSources: [fulfillmentState]
    serves: FulfillmentApi
    port: 4000
  }
}`;
}

const HANDLER = "api/lib/api/fulfillment/workflows/order_fulfillment/on_payment_registered.ex";
const FOLD = "Api.Fulfillment.Workflows.OrderFulfillmentFold.from_events(";
const UNUSED_BIND = `_state = ${FOLD}`;
/** The binding, anchored on a non-identifier char before `state`.
 *
 *  Deliberately a regex and not a `toContain`: the BROKEN output's
 *  `_state = <Fold>.from_events(` contains `state = <Fold>.from_events(` as a
 *  plain substring, so a substring assertion on the binding text passes on the
 *  very output this file exists to reject. */
const BIND_RE =
  /(?<![\w_])state = Api\.Fulfillment\.Workflows\.OrderFulfillmentFold\.from_events\(/;

async function handler(slot: string): Promise<string> {
  const files = await generateSystemFiles(sys(slot));
  const src = files.get(HANDLER);
  expect(src, `${HANDLER} was not emitted`).toBeDefined();
  return src as string;
}

/** Every `state.<field>` read the emitted handler performs. */
function stateReads(src: string): string[] {
  return [...src.matchAll(/(?<![\w_])state\.([a-z_]+)/g)].map((m) => m[1] as string);
}

describe("vanilla elixir ES-workflow fold-snapshot binding", () => {
  // The control: the shape the corpus already carries (a bare `this-prop` ref
  // straight under the precondition).  It worked before the fix too — it is here
  // so a vacuous failure (every case red) is distinguishable from the real one.
  it("binds `state` for a DIRECT state read — the shape that already worked", async () => {
    const src = await handler("paid >= 0");
    expect(BIND_RE.test(src)).toBe(true);
    expect(src).not.toContain(UNUSED_BIND);
  });

  for (const [label, slot] of [
    ["convert", "long(paid) >= 0"],
    ["list literal", "[paid, 0].length > 0"],
    ["ternary inside a convert", "long(cancelled ? paid : 0) >= 0"],
  ] as const) {
    it(`binds \`state\` when the read is inside a ${label}`, async () => {
      const src = await handler(slot);
      // The CONSTRUCTION, not a mention: the broken output binds `_state` and
      // then reads `state.paid`, so a grep for "state" passes on it.
      expect(
        BIND_RE.test(src),
        `the fold snapshot is bound as \`_state\` while the body reads \`state.…\` — ` +
          `\`mix compile\` fails with: undefined variable "state"`,
      ).toBe(true);
      expect(src).not.toContain(UNUSED_BIND);
    });
  }

  // Name-independent: whatever the binding is called, a handler that READS the
  // snapshot must also BIND it.  A future refactor that renames the handle keeps
  // passing; one that drops the binding fails even if it renames.
  it("never reads `state.<field>` from a handler that binds `_state`", async () => {
    const broken: string[] = [];
    for (const slot of [
      "paid >= 0",
      "long(paid) >= 0",
      "[paid, 0].length > 0",
      "long(cancelled ? paid : 0) >= 0",
    ]) {
      const src = await handler(slot);
      const reads = stateReads(src);
      if (reads.length > 0 && !BIND_RE.test(src)) {
        broken.push(`${slot}: reads state.${reads.join(", state.")} but binds \`_state\``);
      }
    }
    expect(
      broken,
      "an ES workflow handler names `state` without binding it — the emitted " +
        "Elixir does not compile:\n" +
        broken.join("\n"),
    ).toEqual([]);
  });
});
