// An enum-typed field's declared default reaches the Ecto schema as an atom in
// the declared casing, so a `managed` field (off the create input, so never
// seeded by the changeset's `__default`) still inserts its default instead of
// NULL into a `null: false` column.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `system Market {
  subdomain Commerce {
    context Store {
      enum OrderStatus { Open, Paid }
      aggregate Order with crudish {
        ref: string
        status: OrderStatus managed = Open
        kind: OrderStatus = Paid
      }
      repository Orders for Order { }
    }
  }
  storage primary { type: postgres }
  resource storeState { for: Store, kind: state, use: primary }
  deployable api { platform: elixir  contexts: [Store]  dataSources: [storeState]  port: 4000 }
}`;

describe("elixir vanilla: enum field default", () => {
  it("renders the declared case as the Ecto.Enum schema default", async () => {
    const files = await generateSystemFiles(SRC);
    const schema = [...files.entries()].find(([p]) => p.endsWith("store/order.ex"))?.[1] ?? "";
    expect(schema).toContain("field :status, Ecto.Enum, values: [:Open, :Paid], default: :Open");
    expect(schema).toContain("field :kind, Ecto.Enum, values: [:Open, :Paid], default: :Paid");
  });
});
