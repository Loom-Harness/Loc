// ---------------------------------------------------------------------------
// The vanilla changeset's wire-ingress seams that no booted leg reaches.
//
// The create path's blank-string and decimal-ingress contracts, and the
// query-time projection's decimal read, are asserted by value on the elixir
// behavioural leg (corpus `validation-messages`, `wire-ingress`,
// `datetime-wire`, against node's golden).  What stays here is what those legs
// cannot observe:
//
//   * `update_changeset`'s own copies of the blank-string and decimal-ingress
//     pipes — the booted leg does not tell them apart from the create path's
//     (reverting the update-path decimal guard leaves `wire-ingress` green).
//   * a blank optional decimal (`""` from a LiveView form) stays absent.
//   * the decimal grammar is node's `moneySchema` regex.
//   * an aggregate with no string or decimal column emits none of the helpers.
//   * the projection and the aggregate serializer share one `__decimal_num/1`.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SYSTEM = `system Ingress {
  subdomain S {
    context C {
      valueobject Rate { amount: money }
      valueobject Offer { price: money  rate: Rate  note: string? }
      valueobject Sku {
        code: string
        invariant code.length >= 3 message "SKU code needs at least 3 characters"
      }
      aggregate Product with crudish {
        name: string check name.length > 0 message "Name is required"
        nick: string?
        price: money
        discount: money?
        weight: decimal
        qty: int
        best: Offer
        sku: Sku
      }
      aggregate Counter with crudish {
        count: int
        enabled: bool
      }
      repository Products for Product { }
      repository Counters for Counter { }
      projection PriceBoard {
        productId: Product id
        price: money
        weight: decimal
        from Product as p
        select productId = p.id, price = p.price, weight = p.weight
      }
    }
  }
  api A from S
  storage primary { type: postgres }
  resource st { for: C, kind: state, use: primary }
  deployable d {
    platform: elixir
    contexts: [C]
    dataSources: [st]
    serves: A
    port: 4000
  }
}`;

let cache: Map<string, string> | undefined;
async function emitted(suffix: string): Promise<string> {
  cache ??= await generateSystemFiles(SYSTEM);
  for (const [p, c] of cache) if (p.endsWith(suffix)) return c;
  throw new Error(`${suffix} not found in: ${[...cache.keys()].join(", ")}`);
}

describe("elixir update_changeset — its own ingress pipes", () => {
  it("re-casts strings with empty_values: [] and guards decimals, after the absent-key check", async () => {
    const cs = await emitted("/c/product_changeset.ex");
    const update = cs.slice(cs.indexOf("def update_changeset"));
    expect(update).toMatch(/\|> cast\(attrs, @string_fields, empty_values: \[\]\)/);
    expect(update).toMatch(/\|> __loom_decimal_ingress\(attrs, @decimal_ingress\)/);
    expect(update.indexOf("|> __require_keys(attrs, @update_required)")).toBeLessThan(
      update.indexOf("|> __require_present(@required_strings)"),
    );
  });

  it("keeps a blank optional decimal absent, on node's grammar", async () => {
    const cs = await emitted("/c/product_changeset.ex");
    expect(cs).toContain("{[:discount], true}");
    expect(cs).toContain('(blank_is_absent and String.trim(value) == "")');
    expect(cs).toContain("Regex.match?(~r/^-?\\d+(\\.\\d+)?$/, value)");
  });

  it("leaves an aggregate with no string column byte-identical", async () => {
    const cs = await emitted("/c/counter_changeset.ex");
    expect(cs).toContain("|> cast(attrs, @all_fields)\n");
    expect(cs).toContain("|> validate_required(@required_fields)\n");
    expect(cs).not.toContain("@string_fields");
    expect(cs).not.toContain("__require_present");
    expect(cs).not.toContain("__loom_decimal_ingress");
  });
});

describe("elixir query-time projection — decimal serialization", () => {
  it("shares one __decimal_num/1 definition with the aggregate's own serializer", async () => {
    const helper = (src: string): string => {
      const start = src.indexOf("  defp __decimal_num(nil)");
      const end = src.indexOf("  defp __decimal_num(other), do: other");
      expect(start).toBeGreaterThanOrEqual(0);
      return src.slice(start, end);
    };
    const proj = await emitted("/price_board.ex");
    const controller = await emitted("/product_controller.ex");
    expect(helper(proj)).toBe(helper(controller));
  });
});
