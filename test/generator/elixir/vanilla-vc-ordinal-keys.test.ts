// A value-collection create can arrive string-keyed (HTTP controller) or
// atom-keyed (workflow-built maps).  The positional `ordinal` stamp must reach
// both, with the element's own key type — a map mixing string and atom keys
// makes Ecto `cast` raise, and a missing ordinal violates the NOT NULL column.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const SRC = `system Inv {
  subdomain Billing {
    context Invoicing {
      valueobject Money { amount: decimal  currency: string }
      aggregate Invoice with crudish {
        reference: string
        lineItems: Money[]
      }
      repository Invoices for Invoice { }
    }
  }
  storage primary { type: postgres }
  resource st { for: Invoicing, kind: state, use: primary }
  deployable api { platform: elixir  contexts: [Invoicing]  dataSources: [st]  port: 4000 }
}`;

describe("elixir vanilla: value-collection ordinal stamping", () => {
  it("looks the collection up under both key types and stamps the element's own key type", async () => {
    const files = await generateSystemFiles(SRC);
    const cs =
      [...files.entries()].find(([p]) => p.endsWith("invoicing/invoice_changeset.ex"))?.[1] ?? "";
    expect(cs).toContain('Enum.reduce([{"line_items", :line_items}], attrs');
    expect(cs).toContain("Map.put(item, ordinal_key(item), i)");
    expect(cs).toContain('if Enum.any?(Map.keys(item), &is_atom/1), do: :ordinal, else: "ordinal"');
  });
});
