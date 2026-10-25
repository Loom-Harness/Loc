import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Derived-property wire projection on vanilla — the EXPLICIT-receiver spelling.
//
// `derived throws: int = this.synchronized + 1` and `derived plus: int =
// synchronized + 1` are one expression and lower to one IR shape (a
// `this-prop` ref), so both project identically.  A `this.<derived>` read
// lowers to the `this-derived` ref the renderer inlines, so it projects too.
// ---------------------------------------------------------------------------

const SOURCE = `
system DerivedThis {
  subdomain Sales {
    context Sales {
      aggregate Ticket with crudish {
        synchronized: int
        derived throws: int = this.synchronized + 1
        derived plus: int = synchronized + 1
        // A this.<derived> read — the this-derived ref, inlined by the renderer.
        derived chained: int = this.throws * 2
      }
      repository Tickets for Ticket { }
    }
  }
  api SalesApi from Sales
  storage pg { type: postgres }
  resource st { for: Sales, kind: state, use: pg }
  deployable api {
    platform: elixir
    contexts: [Sales]
    dataSources: [st]
    serves: SalesApi
    port: 4000
  }
}
`;

describe("vanilla wire projection — a derived spelled `this.<prop>` projects like the bare form", () => {
  it("every spelling renders the same record read, including the this.<derived> read", async () => {
    const files = await generateSystemFiles(SOURCE);
    const key = [...files.keys()].find((k) => k.endsWith("/controllers/ticket_controller.ex"))!;
    expect(key, "ticket controller not emitted").toBeDefined();
    const ctrl = files.get(key)!;
    expect(ctrl).toContain('"throws" => record.synchronized + 1');
    expect(ctrl).toContain('"plus" => record.synchronized + 1');
    expect(ctrl).toContain('"chained" => (record.synchronized + 1) * 2');
    expect(ctrl).not.toContain("record.throws");
  });
});
