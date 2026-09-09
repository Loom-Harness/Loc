import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/parse.js";

// F30 — `loom.projection-event-unkeyed` used to render ONE message for two
// different defects.  For a KEYED projection whose event lacks the key field it
// named the field; for a SINGLETON (no `keyed by` at all) `correlationField` is
// absent, so the same text interpolated it as the literal `undefined` and asked
// the author to add a field nobody can name.  Refusing a keyless fold is
// intentional (10-repositories-and-queries.md); only the wording was wrong.
async function unkeyedMessage(projectionBody: string): Promise<string> {
  const source = `
system Shop {
  subdomain Sales {
    context Orders {
      event OrderPlaced { order: Order id }
      event StockMoved  { sku: string }
      aggregate Order { total: int }
      ${projectionBody}
    }
  }
}`;
  const { model } = await parseString(source, { validate: false });
  const d = validateLoomModel(enrichLoomModel(lowerModel(model))).find(
    (x) => x.code === "loom.projection-event-unkeyed",
  );
  return d?.message ?? "<not raised>";
}

describe("loom.projection-event-unkeyed wording", () => {
  it("names the missing key field when the projection IS keyed", async () => {
    const m = await unkeyedMessage(`
      projection ByOrder keyed by order {
        order: Order id
        n: int
        on(e: StockMoved) { n := n + 1 }
      }`);
    expect(m).toContain("that event has no 'order' field to route by");
  });

  it("never interpolates `undefined` for a SINGLETON — it asks for `keyed by`", async () => {
    const m = await unkeyedMessage(`
      projection Totals {
        n: int
        on(e: OrderPlaced) { n := n + 1 }
      }`);
    expect(m).not.toContain("undefined");
    expect(m).toContain("declares no 'keyed by'");
  });
});
