// Two places the elixir backend must agree with the shared schema about a
// value object.
//
// 1. DELTA migrations.  A value object on an aggregate table is its leaf
//    columns (D-ONE-SCHEMA), on a fresh create-table and on a delta alike, so a
//    value-object field that arrives later adds exactly the leaves a fresh
//    create-table has, and dropping it removes them.
//
// 2. The workflow-instance read route serializes the saga-state row through the
//    wire-shape serializer, so a decimal inside a value object ships as a
//    number whether the row held a JSON number or a Decimal-as-string.

import { describe, expect, it } from "vitest";
import { generateEvolvedSystemFiles, generateSystemFiles } from "../../_helpers/generate.js";

const system = (billBody: string, money = "amount: decimal  currency: string") => `system S {
  subdomain C {
    context C {
      valueobject Money { ${money} }
      aggregate Bill with crudish {
        ${billBody}
      }
      repository Bills for Bill {}
    }
  }
  api A from C
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable d { platform: elixir  contexts: [C]  dataSources: [st]  serves: A  port: 4000 }
}`;

const WITHOUT = system("label: string");
const WITH = system("label: string\n        total: Money?\n        price: Money");

/** The single DELTA migration generated for `next` once `prev` is recorded,
 *  or `undefined` when none was emitted. */
async function delta(prev: string, next: string): Promise<string | undefined> {
  const files = await generateEvolvedSystemFiles([prev, next]);
  const deltas = [...files.keys()].filter(
    (k) => k.includes("/priv/repo/migrations/") && /_gen\d+\.exs$/.test(k),
  );
  expect(deltas.length).toBeLessThanOrEqual(1);
  return deltas[0] ? files.get(deltas[0]) : undefined;
}

describe("elixir delta migration — a value-object field is its leaf columns", () => {
  it("adding a value-object field adds its leaf columns, as the shared schema does", async () => {
    const body = (await delta(WITHOUT, WITH))!;
    expect(body).toBeDefined();
    // An optional VO: nullable leaves, and the null-consistency check over them.
    expect(body).toContain("add :total_amount, :decimal, null: true");
    expect(body).toContain("add :total_currency, :text, null: true");
    expect(body).toContain("create constraint(:bills, :bills_total_null_consistent");
    // A required VO under --allow-destructive: each leaf added nullable, then SET NOT NULL.
    expect(body.match(/modify :price_(amount|currency), :\w+, null: false/g)).toHaveLength(2);
    expect(body).not.toMatch(/(add|modify) :(total|price), :map/);
  });

  it("the delta leaves the table with exactly the columns a fresh create-table has", async () => {
    const createCols = async (src: string): Promise<string[]> => {
      const files = await generateSystemFiles(src);
      return cols(files.get([...files.keys()].find((k) => k.endsWith("_create_bills.exs"))!)!);
    };
    const cols = (s: string): string[] => [...s.matchAll(/add :(\w+),/g)].map((m) => m[1]!);
    const added = cols((await delta(WITHOUT, WITH))!);
    expect([...(await createCols(WITHOUT)), ...added].sort()).toEqual(
      (await createCols(WITH)).sort(),
    );
  });

  it("dropping a value-object field removes its leaf columns", async () => {
    const body = (await delta(WITH, WITHOUT))!;
    expect(body).toContain("remove :total_amount");
    expect(body).toContain("remove :price_currency");
    expect(body).not.toMatch(/remove :(total|price)\n/);
  });

  it("a value object gaining a leaf adds that leaf's column", async () => {
    const body = await delta(
      WITH,
      system(
        "label: string\n        total: Money?\n        price: Money",
        "amount: decimal  currency: string  note: string?",
      ),
    );
    expect(body ?? "").toContain("add :total_note, :text, null: true");
    expect(body ?? "").toContain("add :price_note, :text, null: true");
  });
});

const WORKFLOW = `system S {
  subdomain C {
    context C {
      valueobject Money { amount: decimal  currency: string }
      aggregate Order {
        status: string
        operation place() { status := "Placed"  emit OrderPlaced { order: id, at: now() } }
      }
      repository Orders for Order {}
      event OrderPlaced { order: Order id, at: datetime }
      channel Lifecycle { carries: OrderPlaced  delivery: broadcast  retention: ephemeral }
      workflow Billing {
        orderId: Order id
        total: Money
        rate: decimal
        related: Order id[]
        create(p: OrderPlaced) by p.order { total := Money { amount: 1.0, currency: "EUR" } }
      }
    }
  }
  api A from C
  storage pg { type: postgres }
  resource sagaState { for: C, kind: state, use: pg }
  deployable d { platform: elixir  contexts: [C]  dataSources: [sagaState]  serves: A  port: 4000 }
}`;

describe("elixir workflow-instance read — typed wire, not the raw row (B-A3b)", () => {
  it("serializes the state row through the wire-shape serializer", async () => {
    const files = await generateSystemFiles(WORKFLOW);
    const ctl = files.get(
      [...files.keys()].find((k) => k.endsWith("/workflow_instances_controller.ex"))!,
    )!;
    // Both actions project through one serializer…
    expect(ctl).toContain("Enum.map(D.Repo.all(D.C.Workflows.BillingState), &serialize_billing/1)");
    expect(ctl).toContain("json(conn, serialize_billing(row))");
    expect(ctl).not.toMatch(/total: row\.total/);
    // …which ships the VO through its own helper, whose decimal leaf is a
    // number whether the jsonb held a JSON number or a Decimal-as-string.
    expect(ctl).toContain(`"total" => serialize_money_billing(record.total)`);
    expect(ctl).toContain(
      `"amount" => __decimal_num(Map.get(record, :amount, Map.get(record, "amount")))`,
    );
    expect(ctl).toContain(`"rate" => __decimal_num(record.rate)`);
    expect(ctl).toMatch(/defp __decimal_num\(bin\) when is_binary\(bin\) do/);
    // The correlation field is the PK, and `X id[]` is a plain jsonb id list.
    expect(ctl).toContain(`"orderId" => record.order_id`);
    expect(ctl).toContain(`"related" => record.related`);
    expect(ctl).not.toContain("__ref_ids");
  });
});
