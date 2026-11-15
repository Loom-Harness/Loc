// The generated-test plan's decisions, read off a lowered model: what each
// assertion compares and how its expected literal is built
// (`assertionPlan`), and who a test runs as (`testPrincipal`).  The behaviour
// these decisions produce on each backend is the corpus fixture
// `test-assertions.ddd`; this pins the decision table itself.

import { describe, expect, it } from "vitest";
import { assertionPlan } from "../../src/ir/plan/test-assertion.js";
import { testPrincipal } from "../../src/ir/plan/test-principal.js";
import type { TestStmtIR } from "../../src/ir/types/loom-ir.js";
import { allAggregates } from "../../src/ir/types/loom-ir.js";
import { buildLoomModel } from "../_helpers/index.js";

const SRC = `
  system S {
    user { id: string  role: string  permissions: string[]  email: string  customer: Customer id  since: datetime  nick: string? }
    subdomain D { context C {
      valueobject Price { amount: money  currency: string }
      aggregate Customer { name: string }
      aggregate Order {
        total: money = 0.0
        placedAt: datetime?
        day: date?
        tags: string[]
        customer: Customer id
        qty: int = 0
        test "plans" {
          let o = Order.create(customer: "00000000-0000-0000-0000-000000000001", tags: [])
          let t = o.total
          expect(t).toBe(15)
          expect(t).toBeGreaterThan(10)
          expect(o.placedAt).toBeGreaterThan("2026-01-01T00:00:00Z")
          expect(o.day).not.toBe("2026-01-01")
          expect(Price { amount: 1.50, currency: "USD" }).toBe(Price { amount: 1.5, currency: "USD" })
          expect(o.tags).toBe([])
          expect(o.customer).toBe("00000000-0000-0000-0000-000000000001")
          expect(o.qty).toBeLessThan(3)
          expect(o.placedAt).toBeNull()
          expect(o.tags).toContain("a")
        }
      }
      repository Customers for Customer { }
      repository Orders for Order { }
    } }
    api A from D
    storage primary { type: postgres }
    resource st { for: C, kind: state, use: primary }
    deployable d { platform: node  contexts: [C]  dataSources: [st]  serves: A  auth: required  port: 4000 }
  }
`;

const expects = (stmts: readonly TestStmtIR[]) =>
  stmts.flatMap((s) => (s.kind === "expect" ? [assertionPlan(s.expr)] : []));

describe("assertionPlan", () => {
  it("decides the comparison and the expected literal from the subject's type", async () => {
    const loom = await buildLoomModel(SRC);
    const order = allAggregates(loom).find((a) => a.name === "Order")!;
    const plans = expects(order.tests[0]!.statements).map((p) =>
      p?.kind === "compare"
        ? [p.relation, p.compare, p.negate, p.expectedLiteral.kind]
        : p?.kind === "contain"
          ? ["contain", p.within]
          : [p?.kind],
    );
    expect(plans).toEqual([
      // A let-bound money subject compares by value, the literal an exact decimal.
      ["eq", "decimal", false, "money"],
      ["gt", "decimal", false, "money"],
      // An ordering matcher builds the ISO string at the subject's type too.
      ["gt", "instant", false, "datetime"],
      ["eq", "date", true, "date"],
      ["eq", "structural", false, "none"],
      ["eq", "sequence", false, "none"],
      // An id compares against the id the string names.
      ["eq", "scalar", false, "id"],
      ["lt", "scalar", false, "none"],
      ["null"],
      ["contain", "collection"],
    ]);
  });
});

describe("testPrincipal", () => {
  it("carries every declared claim at its dev-stub value, overrides replacing", async () => {
    const loom = await buildLoomModel(SRC);
    const user = loom.systems[0]!.user!.fields;
    const values = (overrides?: Parameters<typeof testPrincipal>[1]) =>
      testPrincipal(user, overrides).map((c) => [c.field.name, c.value]);
    expect(values()).toEqual([
      ["id", { kind: "text", value: "admin" }],
      ["role", { kind: "text", value: "admin" }],
      ["permissions", { kind: "list", element: { kind: "primitive", name: "string" }, values: [] }],
      ["email", { kind: "text", value: "admin" }],
      [
        "customer",
        { kind: "id", targetName: "Customer", value: "00000000-0000-0000-0000-000000000000" },
      ],
      ["since", { kind: "datetime" }],
      ["nick", { kind: "absent" }],
    ]);
    const overridden = values({
      claims: [
        { name: "role", value: "agent" },
        { name: "permissions", value: ["a", "b"] },
      ],
    });
    expect(overridden[1]).toEqual(["role", { kind: "text", value: "agent" }]);
    expect(overridden[2]).toEqual([
      "permissions",
      {
        kind: "list",
        element: { kind: "primitive", name: "string" },
        values: [
          { kind: "text", value: "a" },
          { kind: "text", value: "b" },
        ],
      },
    ]);
  });
});
