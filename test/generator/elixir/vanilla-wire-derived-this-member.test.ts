import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

// ---------------------------------------------------------------------------
// Derived-property wire projection on vanilla — the EXPLICIT-receiver spelling.
//
// `derived throws: int = this.synchronized + 1` and `derived plus: int =
// synchronized + 1` are one expression, but they lower differently: the bare
// name is a `this-prop` ref, the `this.` form a `member` on a `this` node.  The
// serializer's renderability walk (`derivedRenderable`, wire-serialize.ts)
// declined every `this` receiver, so a derived spelled with `this.` was
// silently dropped off the wire on this backend alone — the `java-reserved-
// words` corpus e2e read `throws` back as undefined (behavioral-elixir, PR
// #2907), while the served OpenAPI listed it in `required:`.  The renderer
// emits the same `record.<field>` for both spellings, so both project now.
// A `this.<derived>` member read still declines (the renderer does not inline
// the member spelling — only the `this-derived` ref — so it would emit a
// KeyError-raising `record.<derived>`).
// ---------------------------------------------------------------------------

const SOURCE = `
system DerivedThis {
  subdomain Sales {
    context Sales {
      aggregate Ticket with crudish {
        synchronized: int
        derived throws: int = this.synchronized + 1
        derived plus: int = synchronized + 1
        // A this.<derived> read — not inlined by the renderer, must stay skipped.
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
  it("both spellings render the same record read; the this.<derived> read stays skipped", async () => {
    const files = await generateSystemFiles(SOURCE);
    const key = [...files.keys()].find((k) => k.endsWith("/controllers/ticket_controller.ex"))!;
    expect(key, "ticket controller not emitted").toBeDefined();
    const ctrl = files.get(key)!;
    expect(ctrl).toContain('"throws" => record.synchronized + 1');
    expect(ctrl).toContain('"plus" => record.synchronized + 1');
    expect(ctrl).not.toContain('"chained"');
    expect(ctrl).not.toContain("record.throws");
  });
});
