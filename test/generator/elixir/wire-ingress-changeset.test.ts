// ---------------------------------------------------------------------------
// The vanilla changeset's WIRE-INGRESS contract, and the projection's decimal
// read — three elixir-only runtime divergences from node, each pinned on the
// surface the request actually hits.
//
//   * A blank string reaches the rule that owns it.  Ecto's default `cast/3`
//     turns `""` / `"   "` into nil and `validate_required/2` calls a blank
//     string missing, so `check name.length > 0 message "Name is required"`
//     never ran: elixir answered "can't be blank" (or a 500) where node answers
//     the authored text and its `msg.<hash>` code.  String columns (and a value
//     object's string leaves) are cast with `empty_values: []`; presence is
//     nil-only.
//   * A malformed decimal is node's `Invalid decimal: "…"` at the LEAF pointer —
//     on the crudish create/update body (Ecto said "is invalid") and inside a
//     value object (stored verbatim before).
//   * A query-time projection's joined plain `decimal` is a JSON number, not
//     the string Jason renders a `%Decimal{}` as (RS-24).
//
// The runtime half is the corpus fixtures `validation-messages`, `wire-ingress`
// and `datetime-wire` on the elixir behavioural leg, against node's golden.
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

describe("elixir changeset — a blank string reaches its rule", () => {
  it("casts string columns with empty_values: [] and checks their presence nil-only", async () => {
    const cs = await emitted("/c/product_changeset.ex");
    expect(cs).toContain("@string_fields [:name, :nick]");
    expect(cs).toContain("@required_strings [:name]");
    // Both seams: create and the full-replacement update.
    expect(cs.match(/\|> cast\(attrs, @string_fields, empty_values: \[\]\)/g)?.length).toBe(2);
    expect(cs).toContain("|> cast(attrs, @all_fields -- @string_fields)");
    expect(cs).toContain("|> validate_required(@required_fields -- @required_strings)");
    expect(cs.match(/\|> __require_present\(@required_strings\)/g)?.length).toBe(2);
    // Nil-only: `validate_required/2` would call "" missing.
    expect(cs).toContain("defp __require_present(changeset, fields) do");
    expect(cs).toContain("if is_nil(get_field(cs, field)) and not Keyword.has_key?(cs.errors, field),");
    // The update seam keeps its absent-key check ahead of the presence check.
    expect(cs.indexOf("|> __require_keys(attrs, @update_required)")).toBeLessThan(
      cs.indexOf("|> __require_present(@required_strings)", cs.indexOf("def update_changeset")),
    );
  });

  it("re-casts a value object's string leaves the same way", async () => {
    const vo = await emitted("/c/sku.ex");
    expect(vo).toContain("@string_fields [:code]");
    expect(vo).toContain("|> cast(attrs, Map.keys(@types) -- @string_fields)");
    expect(vo).toContain("|> cast(attrs, @string_fields, empty_values: [])");
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

describe("elixir changeset — a malformed decimal is node's refusal at the leaf", () => {
  it("guards every top-level decimal column and every value-object decimal leaf", async () => {
    const cs = await emitted("/c/product_changeset.ex");
    expect(cs).toContain(
      "@decimal_ingress [{[:price], false}, {[:discount], true}, {[:weight], false}, " +
        "{[:best, :price], false}, {[:best, :rate, :amount], false}]",
    );
    // Right after the casts, on both seams, so a top-level cast error is
    // replaced before `validate_required/2` looks at the field.
    const createBody = cs.slice(cs.indexOf("def base_changeset"), cs.indexOf("def update_changeset"));
    expect(createBody).toMatch(
      /\|> cast\(attrs, @string_fields, empty_values: \[\]\)\n\s+\|> __loom_decimal_ingress\(attrs, @decimal_ingress\)/,
    );
    expect(cs.match(/\|> __loom_decimal_ingress\(attrs, @decimal_ingress\)/g)?.length).toBe(2);
  });

  it("answers node's text and grammar, at the leaf's pointer, replacing Ecto's cast error", async () => {
    const cs = await emitted("/c/product_changeset.ex");
    expect(cs).toContain('add_error(field, "Invalid decimal: " <> Jason.encode!(value), loom_path: rest)');
    expect(cs).toContain("Regex.match?(~r/^-?\\d+(\\.\\d+)?$/, value)");
    expect(cs).toContain("f == field and opts[:validation] == :cast");
    // A blank optional top-level column stays absent (a LiveView form posts "").
    expect(cs).toContain('(blank_is_absent and String.trim(value) == "")');
  });
});

describe("elixir query-time projection — a decimal select is a JSON number", () => {
  it("routes a decimal select through __decimal_num/1 and money through __money_round/1", async () => {
    const proj = await emitted("/price_board.ex");
    expect(proj).toContain("weight: __decimal_num(record.weight)");
    expect(proj).toContain("price: __money_round(record.price)");
    expect(proj).toContain("defp __decimal_num(%Decimal{} = dec), do: Decimal.to_float(dec)");
  });

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
