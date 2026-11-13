import { describe, expect, it } from "vitest";
import { createUiHarness } from "../../web/src/testing/ui-harness.js";

// The generated `e2e/fixtures.ts` does `export const test = base.extend({...})`
// and the UI spec registers its cases on that extended `test`.  The in-browser
// harness must accept it, or UI-suite discovery throws
// `test.extend is not a function` and the Tests tab lists nothing.

describe("UI harness test.extend", () => {
  it("registers cases declared on an extended test", () => {
    const h = createUiHarness();
    const extended = h.test.extend({ _consoleCapture: [async () => {}, { auto: true }] });
    extended("lists orders", async () => {});
    extended.extend({})("creates an order", async () => {});
    expect(h.tests.map((t) => t.name)).toEqual(["lists orders", "creates an order"]);
  });
});
