import { describe, expect, it } from "vitest";
import { createHarness, runTests } from "../../web/src/testing/harness.js";

// A failed case's error says what failed: an expectation reads as expected vs
// actual; anything else threw before an assertion settled the case (the
// domain operation under test refused) and is named as such, with its type.

class DomainError extends Error {
  override name = "DomainError";
}

describe("runTests failure text", () => {
  it("names a throw before the assertion and keeps an expectation's own message", async () => {
    const h = createHarness();
    h.it("withdraw throws before expect", () => {
      const withdraw = (): number => {
        throw new DomainError("Business rule violated");
      };
      h.expect(withdraw()).toBe(12345);
    });
    h.it("expectation fails", () => {
      h.expect(1).toBe(2);
    });
    const [threw, failed] = await runTests(h.tests);
    expect(threw?.error).toBe(
      "The test threw before its assertion completed — DomainError: Business rule violated",
    );
    expect(failed?.error).not.toMatch(/threw before/);
    expect(failed?.error).toMatch(/2/);
  });
});
