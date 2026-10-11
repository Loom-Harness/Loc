// Eval-closure follow-up B-A3b — two places the elixir backend still treated a
// value object as the other backends' flattened leaf columns / raw values.
//
// 1. DELTA migrations.  Every Ecto create-table path stores a value object as
//    ONE `:map` column (`collapseVoGroups`) and the schema reads
//    `field :price, :map`, but a value-object field that arrived LATER went
//    through the delta path leaf by leaf: `add :price_amount, :decimal` /
//    `add :price_currency, :text` (plus a `modify` per leaf), so the table
//    never grew the `price` column the schema reads.  Dropping the field
//    removed leaf columns that never existed.
//
// 2. The workflow-instance read route dumped `row.<field>` raw.  A value
//    object written from domain code holds its decimal as a `%Decimal{}`,
//    which the jsonb column stores as a JSON STRING, so the read shipped
//    `"amount": "1.0"` where every other backend ships a number.

import { describe, expect, it } from "vitest";
import type { SchemaSnapshot } from "../../../src/ir/types/migrations-ir.js";
import { memorySnapshotStore } from "../../../src/system/snapshot.js";
import { generateSystemFiles } from "../../_helpers/generate.js";

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

async function snapshotOf(src: string): Promise<SchemaSnapshot> {
  const files = await generateSystemFiles(src);
  return JSON.parse(files.get(".loom/snapshots/C.snapshot.json")!) as SchemaSnapshot;
}

/** The single DELTA migration (`…_migrate.exs`) generated for `next` against
 *  `prev`'s snapshot, or `undefined` when none was emitted. */
async function delta(prev: string, next: string): Promise<string | undefined> {
  const files = await generateSystemFiles(next, {
    snapshots: memorySnapshotStore({ C: await snapshotOf(prev) }),
    allowDestructive: true,
  });
  const deltas = [...files.keys()].filter(
    (k) => k.includes("/priv/repo/migrations/") && !k.endsWith("_create_bills.exs"),
  );
  expect(deltas.length).toBeLessThanOrEqual(1);
  return deltas[0] ? files.get(deltas[0]) : undefined;
}

describe("elixir delta migration — a value-object field is ONE :map column (B-A3b)", () => {
  it("adding a value-object field adds the :map column the schema reads, not its leaves", async () => {
    const body = (await delta(WITHOUT, WITH))!;
    expect(body).toBeDefined();
    // An optional VO: one nullable map.
    expect(body).toContain("add :total, :map, null: true");
    // A required VO under --allow-destructive: add nullable, then SET NOT NULL —
    // once for the map, not once per leaf.
    expect(body).toContain("add :price, :map, null: true");
    expect(body.match(/modify :price, :map, null: false/g)).toHaveLength(1);
    expect(body).not.toMatch(/(add|modify) :(total|price)_(amount|currency)/);
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

  it("dropping a value-object field removes the :map column", async () => {
    const body = (await delta(WITH, WITHOUT))!;
    expect(body).toContain("remove :total");
    expect(body).toContain("remove :price");
    expect(body).not.toMatch(/remove :(total|price)_/);
  });

  it("a value object gaining a leaf needs no column: the map already holds it", async () => {
    const body = await delta(
      WITH,
      system(
        "label: string\n        total: Money?\n        price: Money",
        "amount: decimal  currency: string  note: string?",
      ),
    );
    expect(body ?? "").not.toMatch(/_note\b/);
    expect(body ?? "").not.toMatch(/add :(total|price)\b/);
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
