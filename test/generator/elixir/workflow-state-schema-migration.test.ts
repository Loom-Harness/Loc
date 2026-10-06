// Eval-closure item 14a — the Phoenix saga-state Ecto schema and the
// state-table migration must describe the SAME columns.
//
// `ectoStateFieldType` used to map every non-primitive state field to
// `:string`: a value object (`total: Money`) became `field :total, :string`
// while the migration flattened it into `total_amount` / `total_currency`, so
// the schema named a column that did not exist and the starter's
// `Repo.insert!(%…State{total: nil})` wrote NULL into NOT NULL leaves.  An
// optional `datetime` fell through the same arm (`:string` over a
// `timestamptz`).
//
// The invariant pinned here is structural, not a spot check: for a workflow
// carrying every state-field shape, the set of `field :x, T` lines equals the
// set of non-PK `add :x, C` lines, and each T is the Ecto type that loads C.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `system S {
  subdomain C {
    context C {
      valueobject Money { amount: decimal  currency: string }
      enum Stage { Open, Closed }
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
        refund: Money?
        placedAt: datetime
        closedAt: datetime?
        stage: Stage
        attempts: int
        note: string?
        flagged: bool
        related: Order id[]
        create(p: OrderPlaced) by p.order { total := Money { amount: 1.0, currency: "EUR" }  placedAt := p.at }
      }
    }
  }
  api A from C
  storage pg { type: postgres }
  resource sagaState { for: C, kind: state, use: pg }
  deployable d { platform: elixir  contexts: [C]  dataSources: [sagaState]  serves: A  port: 4000 }
}`;

/** The Ecto schema type that loads each migration column type. */
const LOADS: Record<string, string> = {
  ":map": ":map",
  ":text": ":string",
  ":integer": ":integer",
  ":boolean": ":boolean",
  ":decimal": ":decimal",
  ":timestamptz": "Loom.Datetime",
};

async function generated(): Promise<Map<string, string>> {
  return generateSystemFiles(SRC);
}

function file(files: Map<string, string>, suffix: string): string {
  const key = [...files.keys()].find((k) => k.endsWith(suffix));
  expect(key, `${suffix} not emitted`).toBeDefined();
  return files.get(key!)!;
}

describe("elixir workflow state — schema fields == migration columns (item 14a)", () => {
  it("every schema field has a migration column of a type it loads, and vice versa", async () => {
    const files = await generated();
    const schema = file(files, "/workflows/billing_state.ex");
    const migration = file(files, "_create_billings.exs");

    const fields = new Map(
      [...schema.matchAll(/^\s*field :(\w+), (.+)$/gm)].map((m) => [m[1]!, m[2]!.trim()]),
    );
    const columns = new Map(
      [...migration.matchAll(/^\s*add :(\w+), (:\w+), (?!primary_key)/gm)].map((m) => [
        m[1]!,
        m[2]!,
      ]),
    );

    expect([...fields.keys()].sort()).toEqual([...columns.keys()].sort());
    for (const [name, col] of columns) {
      // A reference collection (`X id[]`) is a jsonb id list: an array of the
      // id's JSON form, never Ecto's 16-byte `:binary_id` dump.  An enum is a
      // text column loaded through `Ecto.Enum` (the body assigns the member
      // atom — wave C3 D6).
      const want =
        name === "related"
          ? "{:array, :string}"
          : name === "stage"
            ? "Ecto.Enum, values: [:Open, :Closed]"
            : LOADS[col];
      expect(fields.get(name), `field :${name} over column ${col}`).toBe(want);
    }
    // The value objects specifically (the 14a repro) and the optional datetime
    // (its sibling): one `:map` / `Loom.Datetime`, no flattened leaves.
    expect(fields.get("total")).toBe(":map");
    expect(fields.get("refund")).toBe(":map");
    expect(fields.get("closed_at")).toBe("Loom.Datetime");
    expect(migration).not.toMatch(/total_amount|total_currency|refund_amount/);
    expect(migration).toContain("add :total, :map, null: false");
    expect(migration).toContain("add :refund, :map, null: true");
  });

  it("the starter allocates a NOT NULL value-object / enum field with a zero, not nil", async () => {
    const files = await generated();
    const starter = file(files, "/workflows/billing/start_order_placed.ex");
    expect(starter).toContain('total: %{amount: Decimal.new(0), currency: ""}');
    expect(starter).toContain("stage: :Open");
    expect(starter).not.toMatch(/\b(total|stage): nil\b/);
    // The body's own write is the same `:map` shape the column now holds.
    expect(starter).toContain('%{total: %{amount: Decimal.new("1.0"), currency: "EUR"}}');
  });
});
