// A value object reaches the elixir backend as a raw wire map — a jsonb `:map`
// column on create/update, a bare `Map.get(params, …)` on an operation — so its
// members are only as declared as the request makes them.  Both ingress paths
// cast it against the value object's declared fields: a missing member is the
// 422 at `/<field>/<member>` (it used to reach an invariant or the op body as
// nil and raise, a 500), and only declared members are kept.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const SRC = `
system S {
  subdomain D {
    context Pay {
      valueobject Money { amount: decimal  currency: string  note: string? }
      aggregate Wallet with crudish {
        owner: string
        balance: Money
        invariant balance.amount >= 0
        operation topUp(amount: Money) {
          balance := Money { amount: balance.amount + amount.amount, currency: balance.currency }
        }
      }
      repository Wallets for Wallet { }
    }
  }
  api A from D
  storage pg { type: postgres }
  resource st { for: Pay, kind: state, use: pg }
  deployable api { platform: elixir contexts: [Pay] dataSources: [st] serves: A port: 4000 }
}
`;

const file = (files: Map<string, string>, suffix: string): string =>
  files.get([...files.keys()].find((k) => k.endsWith(suffix))!)!;

describe("elixir — value-object wire maps are cast against the declaration", () => {
  it("create/update shape a VO field before the invariants read it", async () => {
    const cs = file(await generateSystemFiles(SRC), "/pay/wallet_changeset.ex");
    const shape = "|> __shape_vo(:balance, [:amount, :currency, :note], [:amount, :currency])";
    // Both the create and the update changeset carry it, ahead of the invariants.
    expect(cs.split(shape).length - 1).toBe(2);
    expect(cs.indexOf(shape)).toBeLessThan(cs.indexOf("|> validate_invariants()"));
    expect(cs).toContain("shaped = Map.filter(value, fn {k, _} -> to_string(k) in names end)");
    expect(cs).toContain(
      'add_error(cs, field, "can\'t be blank", validation: :required, loom_path: [key])',
    );
  });

  it("a VO operation param is cast through its own with-clause", async () => {
    const facade = file(await generateSystemFiles(SRC), "/lib/api/pay.ex");
    expect(facade).toContain(
      'with {:ok, amount} <- __loom_vo_param(record, :amount, Map.get(params, "amount"), %{amount: :decimal, currency: :string, note: :string}, [:amount, :currency])',
    );
    expect(facade).toContain("defp __loom_vo_param(record, field, value, types, required)");
    // The raw param is not also bound flat ahead of the clause.
    expect(facade).not.toContain('amount = Map.get(params, "amount")');
  });
});
