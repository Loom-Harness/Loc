import { describe, expect, it } from "vitest";
import { discoverSuites } from "../../web/src/testing/discover.js";

// Tests-tab discovery loads each generated suite on its own: a suite that
// fails to load is reported by name and the others stay listed — one broken
// UI spec used to empty the whole Tests list.

const ok =
  <T>(v: T) =>
  async (): Promise<T> =>
    v;
const broken = (msg: string) => async (): Promise<never> => {
  throw new Error(msg);
};

describe("discoverSuites", () => {
  it("a UI suite that fails to load leaves the unit and API suites listed", async () => {
    const steps: string[] = [];
    const found = await discoverSuites(
      {
        units: [
          { label: "order", path: "api/domain/order.test.ts", load: ok(["creates an order"]) },
          {
            label: "money",
            path: "api/domain/money.test.ts",
            load: broken("cannot resolve ./ids"),
          },
        ],
        ui: {
          label: "UI",
          path: "web/e2e/app.ui.spec.ts",
          load: broken("test.extend is not a function"),
        },
        api: { label: "API", path: "api/e2e/api.spec.ts", load: ok(["lists orders"]) },
      },
      { step: (l) => steps.push(l), cancelled: () => false },
    );
    expect(found?.units).toEqual([
      { label: "order", path: "api/domain/order.test.ts", cases: ["creates an order"] },
    ]);
    expect(found?.ui).toBeNull();
    expect(found?.api).toEqual(["lists orders"]);
    expect(found?.failures.map((f) => [f.suite, f.message])).toEqual([
      ["money", "cannot resolve ./ids"],
      ["UI", "test.extend is not a function"],
    ]);
    expect(steps).toEqual(["order", "money", "UI", "API"]);
  });

  it("stops when cancelled", async () => {
    let cancelled = false;
    const found = await discoverSuites(
      {
        units: [{ label: "a", path: "a.test.ts", load: async () => ((cancelled = true), []) }],
        ui: null,
        api: { label: "API", path: "api.spec.ts", load: ok([]) },
      },
      { step: () => {}, cancelled: () => cancelled },
    );
    expect(found).toBeNull();
  });
});
