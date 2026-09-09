import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// M-T6.48, elixir arm — a malformed numeric op param is a 422, not a 500.
//
// `coerceOpParam` made the WELL-FORMED wire shapes total (money/decimal/datetime)
// but left two holes, both 500s:
//
//   • `int`/`bool` were not coerced at all, so a non-integer `int` op param
//     reached `force_change` → `Ecto.ChangeError`.  That is the exact failure
//     its own docstring documents for the money case it was written to fix —
//     the fix stopped one type short.
//   • the money arm itself raised: `Decimal.new(to_string("12,50"))` throws.
//
// The guard is a `with` CLAUSE, not a bind, because a coercion that can fail
// needs somewhere to short-circuit to: `{:error, changeset}` lands on the path
// `ProblemDetails.validation_error_response/2` already renders — 422 with a
// `/<param>` pointer — reusing the envelope the backend already sends rather
// than inventing a second one.  Sibling of the .NET and python arms.
// ---------------------------------------------------------------------------

const src = (body: string) => `
system S {
  subdomain D {
    context C {
      aggregate Order with crudish {
        total: money
        qty:   int
        ${body}
      }
      repository Orders for Order { }
    }
  }
  api A from D
  storage db { type: postgres }
  resource st { for: C, kind: state, use: db }
  deployable api1 { platform: elixir contexts: [C] dataSources: [st] serves: A port: 4000 }
}
`;

const ctxOf = async (body: string) => {
  const files = await generateSystemFiles(src(body));
  return [...files.entries()].find(([p]) => p.endsWith("lib/api1/c.ex"))?.[1] as string;
};

describe("elixir numeric op-param ingress (M-T6.48)", () => {
  it("guards a money param in the with-chain instead of binding it raw", async () => {
    const ctx = await ctxOf("operation retotal(amount: money) { total := amount }");
    expect(ctx).toContain(
      'with {:ok, amount} <- __loom_decimal_param(record, :amount, Map.get(params, "amount"))',
    );
    // The raw bind is GONE — keeping it would shadow the validated value with
    // the unvalidated one, which is the whole defect.
    expect(ctx).not.toMatch(/amount = \(if is_nil\(Map\.get\(params, "amount"\)\)/);
  });

  it("guards an int param, which had no coercion at all", async () => {
    const ctx = await ctxOf("operation restock(n: int) { qty := n }");
    expect(ctx).toContain('with {:ok, n} <- __loom_int_param(record, :n, Map.get(params, "n"))');
  });

  it("refuses with the cross-backend message, on the changeset that renders 422", async () => {
    const ctx = await ctxOf("operation retotal(amount: money) { total := amount }");
    // node's `moneySchema` and .NET's `WireFormatException` both say
    // `Invalid decimal: "12,50"`; the wire-golden differential compares bodies
    // across backends, so a divergent message is itself a divergence.
    expect(ctx).toContain('__loom_param_error(record, field, value, "Invalid decimal")');
    expect(ctx).toContain(
      'Ecto.Changeset.add_error(field, message <> ": " <> Jason.encode!(value))',
    );
    // node's regex, character for character.
    expect(ctx).toContain("~r/^-?\\d+(\\.\\d+)?$/");
  });

  it("emits ONLY the helpers a context actually calls", async () => {
    // `mix compile --warnings-as-errors` rejects an unused private function, so
    // an int-only context must not carry the decimal helper. The generated
    // Phoenix build caught exactly this; no string test would have.
    const intOnly = await ctxOf("operation restock(n: int) { qty := n }");
    expect(intOnly).toContain("defp __loom_int_param");
    expect(intOnly).not.toContain("__loom_decimal_param");

    const moneyOnly = await ctxOf("operation retotal(amount: money) { total := amount }");
    expect(moneyOnly).toContain("defp __loom_decimal_param");
    expect(moneyOnly).not.toContain("__loom_int_param");
  });

  it("guards an EXTERN op's params too — before the hook is ever called", async () => {
    // A separate renderer with its own param-bind path, and one a mutation
    // proof caught as untested: the guard must lead the `with` chain there as
    // well, so a malformed param cannot reach the user-owned hook at all.
    const ctx = await ctxOf("operation flag(score: int) extern { precondition score >= 0 }");
    expect(ctx).toContain(
      'with {:ok, score} <- __loom_int_param(record, :score, Map.get(params, "score"))',
    );
    // …and it must not ALSO be bound raw ahead of the chain, which would
    // shadow the validated value with the unvalidated one.
    expect(ctx).not.toMatch(/score = Map\.get\(params, "score"\)/);
  });

  it("a context with no guarded param carries no helper at all", async () => {
    const ctx = await ctxOf("operation rename(label: string) { }");
    expect(ctx).not.toContain("__loom_param_error");
    expect(ctx).not.toContain("__loom_decimal_param");
    expect(ctx).not.toContain("__loom_int_param");
  });
});
