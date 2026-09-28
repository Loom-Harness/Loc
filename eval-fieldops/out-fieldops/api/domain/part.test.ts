// Auto-generated.  Do not edit by hand.
import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { Part } from "./part.ts";

describe("Part", () => {
  it("consuming more than stock is rejected", () => {
    const p = Part.create({ sku: "SKU-1", binCode: "A-1", onHand: 2, unitPrice: new Decimal("10.00"), currency: "EUR" });
    expect(() => { p.consume(5); }).toThrow();
  });

});
//# sourceMappingURL=part.test.ts.map
