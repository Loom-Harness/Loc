import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// Two aggregates of one context declaring the same aggregate `function`
// (`web/src/examples/storefront-elixir.ddd`: `Wallet.isMutable()` and
// `Order.isMutable()`).
//
// Each renders on the context-facade module as a struct-guarded clause, so the
// two dispatch correctly — but each was emitted inside its OWN aggregate's
// block, separated by the other aggregate's façade functions, and
// `mix compile --warnings-as-errors` rejected the module:
//
//   warning: clauses with the same name and arity (number of arguments) should
//   be grouped together, "def is_mutable/1" was previously defined
//   (lib/phoenix_app/storefront.ex:182)
//   warning: redefining @doc attribute previously set at line 180.
//
// The colliding `name/arity` now renders ONCE, grouped at the first declaring
// aggregate: one `@doc`, every clause's `@spec`, then the clauses back to back.
// A function only one aggregate declares — or the same name at a different
// arity, which Elixir treats as a different function — is unchanged.
// ---------------------------------------------------------------------------

const SRC = `
system Grouping {
  subdomain S {
    context Shop {
      enum WalletStatus { Open, Frozen }
      enum OrderStatus { Draft, Confirmed }

      aggregate Wallet with crudish {
        status: WalletStatus
        balance: int
        function isMutable(): bool = status == Open
        function bonus(): int = balance
        operation topUp(amount: int) {
          precondition isMutable()
          balance := balance + amount
        }
      }

      aggregate Note shape: document, with crudish {
        status: OrderStatus
        body: string
        function isMutable(): bool = status == Draft
        operation edit(text: string) {
          precondition isMutable()
          body := text
        }
      }

      aggregate Order with crudish {
        status: OrderStatus
        qty: int
        function isMutable(): bool = status == Draft
        function bonus(extra: int): int = qty + extra
        operation confirm() {
          precondition isMutable()
          status := Confirmed
        }
      }
    }
  }
  api ShopApi from S
  storage primary { type: postgres }
  resource st { for: Shop, kind: state, use: primary }
  deployable app {
    platform: elixir
    contexts: [Shop]
    dataSources: [st]
    serves: ShopApi
    port: 4000
  }
}
`;

/** The facade-module lines from the first `def <name>(` clause to the last. */
function clauseSpan(src: string, name: string): string[] {
  const lines = src.split("\n");
  const heads = lines.flatMap((l, i) => (l.startsWith(`  def ${name}(`) ? [i] : []));
  return lines.slice(heads[0], heads[heads.length - 1]! + 1);
}

describe("vanilla Phoenix — same-name aggregate functions across one context's aggregates", () => {
  it("groups the colliding clauses under one @doc, specs first, nothing between", async () => {
    const files = await generateSystemFiles(SRC);
    const facade = [...files].find(([p]) => p.endsWith("/lib/app/shop.ex"))?.[1];
    expect(facade, [...files.keys()].filter((p) => p.endsWith(".ex")).join("\n")).toBeDefined();
    const src = facade!;

    expect(src.match(/@doc "Pure domain function `isMutable`/g)).toHaveLength(1);
    expect(src).toContain(
      [
        '  @doc "Pure domain function `isMutable` on `Wallet`, `Note`, `Order`."',
        "  @spec is_mutable(App.Shop.Wallet.t()) :: boolean()",
        "  @spec is_mutable(App.Shop.Note.Data.t()) :: boolean()",
        "  @spec is_mutable(App.Shop.Order.t()) :: boolean()",
        "  def is_mutable(%App.Shop.Wallet{} = record) do",
      ].join("\n"),
    );
    // The document carrier keeps its `%<Agg>.Data{}` embed head inside the group.
    expect(src).toContain("  def is_mutable(%App.Shop.Note.Data{} = record) do");
    // Between the first and last clause: only `is_mutable` clauses.
    const span = clauseSpan(src, "is_mutable");
    expect(span.filter((l) => l.startsWith("  def is_mutable("))).toHaveLength(3);
    const intruders = span.filter(
      (l) =>
        /^\s*(def|defp|defdelegate|@doc|@spec)\b/.test(l) && !l.startsWith("  def is_mutable("),
    );
    expect(intruders).toEqual([]);
  });

  it("leaves a same NAME at a different arity in its own aggregate block", async () => {
    const files = await generateSystemFiles(SRC);
    const src = [...files].find(([p]) => p.endsWith("/lib/app/shop.ex"))![1];
    expect(src).toContain(
      '  @doc "Pure domain function `bonus` on `Wallet`."\n  @spec bonus(App.Shop.Wallet.t()) :: integer()',
    );
    expect(src).toContain(
      '  @doc "Pure domain function `bonus` on `Order`."\n  @spec bonus(App.Shop.Order.t(), integer()) :: integer()',
    );
  });
});
