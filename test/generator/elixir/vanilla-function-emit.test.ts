import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// Vanilla-Phoenix aggregate `function` member emit (gap §11b,
// docs/old/plans/vanilla-phoenix-gaps.md).
//
// An aggregate `function passed(): bool = total > 100` is a pure domain helper
// callable from op / precondition bodies (`precondition passed()`).  Before this
// fix it was emitted NOWHERE on vanilla and the call site rendered an
// unqualified `passed(record)` → `mix compile` failed on the undefined ref.
// The fix emits `def passed(%Agg{} = record, …)` on the context-facade module
// (and the pure-core schema module) so the call resolves.
// ---------------------------------------------------------------------------

const SRC = `
system FnDemo {
  subdomain Sales {
    context Ordering {
      aggregate Order {
        total: int
        status: string

        function passed(): bool = total > 100
        function bonus(extra: int): int = total + extra

        // Block-body form (domain-services.md rev. 4) — pure: let + precondition
        // + return.  Renders as binding/guard lines then a trailing bare value
        // (no {:ok, …} tuple — a function yields its value directly).
        function shippingFor(extra: int): int {
          let base = total + extra
          precondition base >= 0
          return base
        }

        // F8 — a param read NESTED inside a list / match / implicit convert.
        // Each was invisible to exprUsesParam (walkExpr had no arm), so the
        // clause head underscored q while the body read it, and mix compile
        // failed on the undefined variable.
        function inList(q: int): int {
          let xs = [q, 2, 3]
          return xs.length
        }
        function inMatch(q: int): int {
          let picked = match { q > 1 => 2, else => 3 }
          return picked
        }
        function inConvert(q: int): string {
          let label = "x" + q
          return label
        }

        operation approve() {
          precondition passed()
          status := "approved"
        }

        // A domain test block is what makes the schema module carry the PURE
        // CORE copy of these functions (schema-emit gates it on agg.tests), and
        // that copy had its own receiver-underscore bug.
        test "passed is true above the threshold" {
          let o = Order.create({ total: 150 })
          expect(o.passed()).toBe(true)
        }
      }
      repository Orders for Order { }
    }
  }
  api OrderApi from Sales
  storage primary { type: postgres }
  resource orderState { for: Ordering, kind: state, use: primary }
  deployable api {
    platform: elixir
    contexts: [Ordering]
    dataSources: [orderState]
    serves: OrderApi
    port: 4000
  }
}
`;

async function contextModule(): Promise<string> {
  const files = await generateSystemFiles(SRC);
  for (const [p, c] of files) {
    if (p.endsWith("/ordering.ex")) return c;
  }
  throw new Error("Ordering context module not found");
}

describe("vanilla aggregate `function` emit (gap §11b)", () => {
  it("emits a struct-guarded def for a no-param function", async () => {
    const ctx = await contextModule();
    expect(ctx).toMatch(/def passed\(%Api\.Ordering\.Order\{\} = record\) do/);
    expect(ctx).toContain("record.total > 100");
  });

  it("emits a function with declared params after the struct", async () => {
    const ctx = await contextModule();
    expect(ctx).toMatch(/def bonus\(%Api\.Ordering\.Order\{\} = record, extra\) do/);
    expect(ctx).toContain("record.total + extra");
  });

  it("emits a typespec carrying the aggregate struct as the first arg", async () => {
    const ctx = await contextModule();
    expect(ctx).toMatch(/@spec passed\(Api\.Ordering\.Order\.t\(\)\) :: boolean\(\)/);
    expect(ctx).toMatch(/@spec bonus\(Api\.Ordering\.Order\.t\(\), integer\(\)\) :: integer\(\)/);
  });

  it("qualifies the call site so the precondition resolves to the emitted fn", async () => {
    const ctx = await contextModule();
    // `precondition passed()` in the `approve()` OPERATION hoists into the
    // op's `with ensure(...)` guard chain (403/422 typed denial, not a raise) —
    // the call site still renders `passed(record)`, resolving to the module-level
    // def above (the §11b call-site qualification, which is what this pins).
    expect(ctx).toContain("ensure(passed(record), {:precondition_failed, ");
  });

  it("emits a block-body function as binding/guard lines + a trailing bare value", async () => {
    const ctx = await contextModule();
    expect(ctx).toMatch(/def shipping_for\(%Api\.Ordering\.Order\{\} = record, extra\) do/);
    // `let base = …` → an Elixir binding.
    expect(ctx).toContain("base = record.total + extra");
    // `precondition` → a bug-regime raise guard, typed so the controller rescue
    // routes on `:kind` rather than on the message prefix (M-T6.20).
    expect(ctx).toMatch(
      /if not \(base >= 0\), do: raise\(Api\.GuardError, kind: :precondition, message: "Precondition failed: base >= 0"\)/,
    );
    // `return base` yields the bare value — NOT wrapped in `{:ok, …}`.
    expect(ctx).not.toContain("{:ok, base}");
  });

  // ---- F8 (2026-09-03 language-docs audit) -------------------------------
  // The register anchored this at `bodyUsesParam` and described "used only
  // inside a `let`" — but `bodyExprs` HAS a `let` arm (see `shippingFor`
  // above, which passes).  The defect is one level down: `walkExpr` in
  // `elixir/domain/predicates.ts` had no arm for `list`, `match` or `convert`,
  // so a read nested in one of those was invisible.  Each assertion below is
  // written as "the head binds `q`", which is the thing that must not regress
  // — an assertion on the BODY reading `q` passes either way.

  it("binds a param read inside a list literal (F8)", async () => {
    const ctx = await contextModule();
    expect(ctx).toMatch(/def in_list\(%Api\.Ordering\.Order\{\} = _record, q\) do/);
    expect(ctx).toContain("xs = [q, 2, 3]");
  });

  it("binds a param read inside a match expression (F8)", async () => {
    const ctx = await contextModule();
    expect(ctx).toMatch(/def in_match\(%Api\.Ordering\.Order\{\} = _record, q\) do/);
    expect(ctx).toContain("q > 1 -> 2");
  });

  it("binds a param read under an implicit convert (F8)", async () => {
    const ctx = await contextModule();
    // `"x" + q` lowers to a `convert` node wrapping the param read.
    expect(ctx).toMatch(/def in_convert\(%Api\.Ordering\.Order\{\} = _record, q\) do/);
    expect(ctx).toContain('label = "x" <> to_string(q)');
  });

  it("underscores the PURE-CORE receiver too when the body never reads the struct", async () => {
    // The schema-module copy (`domain-core-emit.ts`) hardcoded `record` while
    // the facade copy underscored it, so a function that reads only its params
    // compiled on one module and failed `mix compile --warnings-as-errors` on
    // the other with "variable record is unused".  Same rule, both copies.
    const files = await generateSystemFiles(SRC);
    const schema = [...files].find(([p]) => p.endsWith("/ordering/order.ex"))?.[1] ?? "";
    expect(schema).toMatch(/def in_list\(%__MODULE__\{\} = _record, q\) do/);
    // Control: a body that DOES read the struct still binds it.
    expect(schema).toMatch(/def passed\(%__MODULE__\{\} = record\) do/);
  });

  it("still underscores a param the body genuinely never reads", async () => {
    // The walk got wider, not permissive: an unused param must keep its
    // underscore or `mix compile --warnings-as-errors` fails the other way.
    const unused = `
system Unused {
  subdomain S {
    context Inv {
      aggregate Gadget {
        name: string
        function label(q: int): string = name
      }
    }
  }
  api InvApi from S
  storage loomDb { type: postgres }
  resource invState { for: Inv, kind: state, use: loomDb }
  deployable api {
    platform: elixir, contexts: [Inv], dataSources: [invState],
    serves: InvApi, port: 4000
  }
}
`;
    const files = await generateSystemFiles(unused);
    const ctx = [...files].find(([p]) => p.endsWith("/inv.ex"))?.[1] ?? "";
    expect(ctx).toMatch(/def label\(%Api\.Inv\.Gadget\{\} = record, _q\) do/);
  });

  it("does not emit any function defs for an aggregate without `function` members", async () => {
    const noFns = `
system NoFns {
  subdomain S {
    context Inv {
      aggregate Gadget {
        name: string
      }
    }
  }
  api InvApi from S
  storage loomDb { type: postgres }
  resource invState { for: Inv, kind: state, use: loomDb }
  deployable api {
    platform: elixir, contexts: [Inv], dataSources: [invState],
    serves: InvApi, port: 4000
  }
}
`;
    const files = await generateSystemFiles(noFns);
    const ctx = [...files].find(([p]) => p.endsWith("/inv.ex"))?.[1] ?? "";
    expect(ctx).toContain("defmodule");
    // No pure-domain-function docstrings — output unchanged for a fn-less agg.
    expect(ctx).not.toContain("Pure domain function");
  });
});
