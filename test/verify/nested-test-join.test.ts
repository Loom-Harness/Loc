import { describe, expect, it } from "vitest";
import { computeVerification } from "../../src/verify/verification.js";
import { buildLoomModel as build } from "../_helpers/index.js";

// A `test … verifies TC-x` joins the traceability graph wherever it is
// declared: nested in an aggregate, a valueobject, a domainService, or directly
// in a context (integration rung).  Each placement reports a different
// `describe` title, and the join keys on it, so a placement the collector
// skips leaves its result "matching no declared test" and the requirement
// UNVERIFIED instead of FAILING.

const SRC = `
  requirement REQ-1 { type: UserStory title: "money is never negative" }
  requirement REQ-2 { type: UserStory title: "an order reads back" }
  requirement REQ-3 { type: UserStory title: "service doubles" }
  requirement REQ-4 { type: UserStory title: "aggregate works" }

  system P {
    subdomain S {
      context C {
        valueobject Price {
          amount: decimal
          invariant amount >= 0
          test "negative price is rejected" verifies TC-1 {
            expect(Price { amount: -1 }).toThrow(invariant)
          }
        }
        aggregate Order with crudish {
          code: string
          test "agg test" verifies TC-4 { expect(1).toBe(1) }
        }
        repository Orders for Order { }
        domainService Calc {
          operation twice(n: int): int { return n * 2 }
          test "twice doubles" verifies TC-3 { expect(Calc.twice(2)).toBe(4) }
        }
        test "an order reads back" verifies TC-2 {
          let o = Order.create(code: "A")
          let r = Order.find(o.id)
          expect(r.code).toBe("A")
        }
      }
    }
    api A from S
    storage pg { type: postgres }
    resource st { for: C, kind: state, use: pg }
    deployable d { platform: node  contexts: [C]  dataSources: [st]  serves: A  port: 4000 }
  }
  testCase TC-1 verifies REQ-1 { title: "negative price" }
  testCase TC-2 verifies REQ-2 { title: "read back" }
  testCase TC-3 verifies REQ-3 { title: "svc" }
  testCase TC-4 verifies REQ-4 { title: "agg" }
`;

describe("verifies joins every test placement", () => {
  it("indexes valueobject, domainService, context and aggregate tests under their describe titles", async () => {
    const loom = await build(SRC);
    const t = loom.traceability!;
    expect(t.execTestsByTestCase["TC-1"]).toEqual(["negative price is rejected"]);
    expect(t.execTestsByTestCase["TC-2"]).toEqual(["an order reads back"]);
    expect(t.execTestsByTestCase["TC-3"]).toEqual(["twice doubles"]);
    expect(t.execTestsByTestCase["TC-4"]).toEqual(["agg test"]);
    const suiteOf = (n: string) => t.execTests.find((e) => e.name === n)?.suite;
    expect(suiteOf("negative price is rejected")).toBe("Price");
    expect(suiteOf("an order reads back")).toBe("C (integration)");
    expect(suiteOf("twice doubles")).toBe("Calc");
    expect(suiteOf("agg test")).toBe("Order");
  });

  it("a failing result in each placement makes its requirement FAILING", async () => {
    const loom = await build(SRC);
    const v = computeVerification(
      loom.traceability!,
      loom.requirements.map((r) => r.id),
      [
        { name: "negative price is rejected", suite: "Price", status: "fail" },
        { name: "an order reads back", suite: "C (integration)", status: "fail" },
        { name: "twice doubles", suite: "Calc", status: "fail" },
        { name: "agg test", suite: "Order", status: "pass" },
      ],
    );
    expect(v.diagnostics.unknownTests).toEqual([]);
    expect(v.requirements["REQ-1"].verdict).toBe("FAILING");
    expect(v.requirements["REQ-2"].verdict).toBe("FAILING");
    expect(v.requirements["REQ-3"].verdict).toBe("FAILING");
    expect(v.requirements["REQ-4"].verdict).toBe("VERIFIED");
  });
});
