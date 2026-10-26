import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// vanilla Phoenix — the WIRE-FORM boundary of a named operation and a declared
// find.  Three separate 500s / silent-wrong-answers, one cause: elixir handed
// the domain a value straight off the wire, in the wire's own form, where every
// other backend deserializes into a TYPED DTO first (zod / pydantic / jackson /
// System.Text.Json).
//
// All three were invisible until the caller census (#2380) gave the routes their
// first runtime callers:
//
//   1. OP PARAM.  `Map.get(params, "amount")` for a `money` param is the raw
//      JSON value; the body `force_change`s it, and `force_change` bypasses
//      casting — `** (Ecto.ChangeError) value "7.25" ... does not match type
//      :decimal`, a 500.  (`corpus/embedded`'s `retotal`.)
//   2. `now()` INTO A datetime COLUMN.  `DateTime.utc_now()` carries
//      microseconds and the column is `:utc_datetime` (second precision), so
//      the same `force_change` path yields `** (ArgumentError) :utc_datetime
//      expects microseconds to be empty`.  `stamp-emit` (B7), `audit-emit` and
//      `provenance-emit` already truncate their own writes — the OPERATION
//      assignment arm never reached the rule.  (`corpus/scaffold-macros`'
//      `softDelete`.)
//   3. FIND PARAM.  Phoenix delivers query params as STRINGS, and an
//      in-memory filter (`shape: document`) compares them directly — Erlang's
//      term order makes `6 >= "6"` false.  The parse is asserted by value on
//      the elixir behavioural leg (`corpus/document`'s `popular`), and an
//      unused coercion helper is a `--warnings-as-errors` failure on its
//      compile, so nothing of it stays here.
// ---------------------------------------------------------------------------

const SOURCE = `
system Shop {
  subdomain Sales {
    context Catalog {
      aggregate Item with crudish, softDeletable, softDelete {
        name: string
        price: money
        viewCount: int
        operation reprice(amount: money) { price := amount }
        operation rename(to: string) { name := to }
      }
      repository Items for Item {
        find popular(min: int): Item[] where this.viewCount >= min
        find named(label: string): Item[] where this.name == label
      }
    }
  }
  api CatalogApi from Sales
  storage pg { type: postgres }
  resource s { for: Catalog, kind: state, use: pg }
  deployable d { platform: elixir, contexts: [Catalog], dataSources: [s], port: 4000 }
}
`;

const fileEndingWith = async (suffix: string): Promise<string> => {
  const files = await generateSystemFiles(SOURCE);
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  expect(hit, `no generated file ending ${suffix}`).toBeDefined();
  return hit![1];
};

describe("vanilla Phoenix — operation params are coerced to their declared type", () => {
  it("a `money` param becomes a Decimal; a `string` param binds bare", async () => {
    const ctxMod = await fileEndingWith("catalog.ex");

    // Premise: both operations exist, so a failure below is about the BINDING.
    expect(ctxMod).toContain("def reprice_item(%D.Catalog.Item{} = record, params)");
    expect(ctxMod).toContain("def rename_item(%D.Catalog.Item{} = record, params)");

    // The money param is coerced AND format-guarded (M-T6.48): the bare
    // `Decimal.new(to_string(...))` this used to assert raises on `"12,50"`, so
    // the coercion moved into a with-clause that can refuse. A JSON number and
    // a JSON string still both land on the same Decimal — that half is
    // unchanged, it just cannot throw any more.
    expect(ctxMod).toContain(
      'with {:ok, amount} <- __loom_decimal_param(record, :amount, Map.get(params, "amount"))',
    );
    // The string param is NOT — a coercion there would be gratuitous output
    // churn, and is what a fix that stringified everything would produce.
    expect(ctxMod).toContain('to = Map.get(params, "to")');
    expect(ctxMod).not.toContain('Decimal.new(to_string(Map.get(params, "to")))');
  });

  it("a datetime column assigned by an operation is normalised to milliseconds (RS-38)", async () => {
    const ctxMod = await fileEndingWith("catalog.ex");
    // `softDelete()` assigns `deletedAt := now()`.
    expect(ctxMod).toContain("def soft_delete_item(%D.Catalog.Item{} = record, params)");
    expect(ctxMod).toContain(
      "Ecto.Changeset.force_change(:deleted_at, __truncate_dt(record.deleted_at))",
    );
    // …through the shared helper, emitted once.  It truncated to the SECOND
    // while the column was `:utc_datetime`; the column is `Loom.Datetime` now
    // (millisecond UTC instant), so the helper puts a `now()` value on the
    // precision the wire prints.
    expect(ctxMod).toContain(
      "defp __truncate_dt(%DateTime{} = dt), do: Loom.Datetime.normalize(dt)",
    );
    // A NON-datetime column on the same persist pipeline is untouched — the
    // scope guard against truncating everything.
    expect(ctxMod).toContain("Ecto.Changeset.force_change(:is_deleted, record.is_deleted)");
  });
});
