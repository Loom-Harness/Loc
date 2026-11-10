// The src/api entry points reuse ONE Langium service set (constructing it runs
// Chevrotain self-analysis, hundreds of ms) and stay isolated per call.
import { describe, expect, it } from "vitest";
import { applyPatches, generate, validate } from "../../src/api/index.js";
import { findSymbol } from "../../src/api/navigate.js";
import { sharedServicesStats } from "../../src/language/shared-services.js";
import { callTool } from "../../src/tools/index.js";

const GOOD = `context Sales { aggregate Order { total: int } }`;
const OTHER = `context Billing { aggregate Invoice { amount: int } }`;
const BROKEN = `context Broken { aggregate X { total: `;

describe("shared Langium services across src/api", () => {
  it("constructs the service set at most once across many mixed calls", async () => {
    await validate(GOOD); // ensure built
    const before = sharedServicesStats.created;
    for (let i = 0; i < 4; i++) {
      await validate(GOOD);
      await generate(GOOD);
      await findSymbol(GOOD, "Order");
      await callTool("loom_validate", { source: GOOD });
    }
    await applyPatches(GOOD, [{ op: "remove", target: "aggregate Sales.Order.total" }]);
    expect(sharedServicesStats.created).toBe(before);
    expect(sharedServicesStats.created).toBe(1);
  });

  it("concurrent calls on different sources return their own results", async () => {
    const [a, b, c, d] = await Promise.all([
      validate(GOOD),
      validate(BROKEN),
      validate(OTHER),
      findSymbol(OTHER, "Invoice"),
    ]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(false);
    expect(c.ok).toBe(true);
    expect("address" in d && d.address).toContain("Billing");
    // A reference to a name only OTHER declares stays unresolved no matter what
    // ran before or alongside: documents never see each other's declarations.
    const REF = `context Sales { aggregate Order { total: int\n inv: Invoice id } }`;
    const alone = await validate(REF);
    const [during] = await Promise.all([validate(REF), validate(OTHER)]);
    await validate(OTHER);
    const after = await validate(REF);
    expect(alone.ok).toBe(false);
    expect(during.diagnostics).toEqual(alone.diagnostics);
    expect(after.diagnostics).toEqual(alone.diagnostics);
    // No declaration leaks into a later call's global scope.
    const refs = await findSymbol(GOOD, "Invoice");
    expect("error" in refs).toBe(true);
  });
});
