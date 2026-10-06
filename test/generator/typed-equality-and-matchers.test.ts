// Banking eval B-13 + B-01 — reference-typed scalars compared by VALUE.
//
// On node a `datetime` is a JS `Date` and a `money` a decimal.js `Decimal`:
// both are OBJECTS, so the native operators the emitters reached for compared
// references.
//
//   * B-13 — `a.startOfDay() == b.startOfDay()` rendered
//     `new Date(…) === new Date(…)`, always false: a daily withdrawal limit
//     keyed on "same day" was never enforced.
//   * B-01 — `expect(a.balance).toBe(money("15"))` rendered
//     `expect(Decimal).toBe(new Decimal("15"))` (vitest `Object.is`), always
//     failing; the ordering matchers reject a non-`number` subject outright.
//
// Elixir's unit-test matchers had the datetime half of B-01: `<`/`>` on a
// `%DateTime{}` struct is structural term ordering, not chronological, and a
// bare `now` literal rendered as an undefined variable.
//
// The fixture goes through the real pipeline (parse → lower → emit) so the
// assertions read the lowering's actual type stamps, not hand-built IR.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

const SOURCE = (platform: string) => `
system R {
  subdomain S { context C {
    aggregate Acct with crudish {
      balance: money
      lastDay: datetime
      closedAt: datetime?
      function sameDay(a: datetime, b: datetime): bool = a.startOfDay() == b.startOfDay()
      function differentDay(a: datetime, b: datetime): bool = a.startOfDay() != b.startOfDay()
      function closedOn(d: datetime): bool = closedAt == d
      function isOpen(): bool = closedAt == null
      operation touch() { lastDay := now() }
      test "money matchers" {
        let a = Acct.create({ balance: money("15.00"), lastDay: now() })
        expect(a.balance).toBe(money("15"))
        expect(a.balance).not.toBe(money("16"))
        expect(a.balance).toBeGreaterThan(money("14.99"))
        expect(a.balance).not.toBeLessThan(money("15"))
      }
      test "datetime matchers" {
        let a = Acct.create({ balance: money("1"), lastDay: now() })
        expect(a.lastDay).toBe(a.lastDay)
        expect(a.lastDay).toBeLessThanOrEqual(now())
      }
    }
    repository Accts for Acct { }
  } }
  storage pg { type: postgres }
  resource st { for: C, kind: state, use: pg }
  deployable api { platform: ${platform}, contexts: [C], dataSources: [st], port: 3000 }
}
`;

async function file(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(SOURCE(platform));
  const hit = [...files.entries()].find(([p]) => p.endsWith(suffix));
  if (!hit) throw new Error(`no generated file ending in ${suffix}`);
  return hit[1];
}

describe("B-13 — node `datetime ==` compares instants, not references", () => {
  it("non-null datetime equality / inequality go through getTime()", async () => {
    const acct = await file("node", "domain/acct.ts");
    const sameDay = acct.split("\n").find((l) => l.includes("public sameDay("));
    const differentDay = acct.split("\n").find((l) => l.includes("public differentDay("));
    expect(sameDay).toMatch(/\)\.getTime\(\) === \(.*\)\.getTime\(\);/);
    expect(differentDay).toMatch(/\)\.getTime\(\) !== \(.*\)\.getTime\(\);/);
  });

  it("a nullable side optional-chains; a `null` literal stays a null check", async () => {
    const acct = await file("node", "domain/acct.ts");
    expect(acct).toContain("return (this._closedAt)?.getTime() === (d).getTime();");
    expect(acct).toContain("return this._closedAt === null;");
  });
});

describe("B-01 — unit-test value matchers are subject-type aware", () => {
  it("node: money toBe compares canonical decimal strings; ordering via comparedTo", async () => {
    const t = await file("node", "domain/acct.test.ts");
    expect(t).toContain(
      'expect(String(a.balance)).toBe(new Decimal(new Decimal("15")).toString());',
    );
    expect(t).toContain(
      'expect(String(a.balance)).not.toBe(new Decimal(new Decimal("16")).toString());',
    );
    expect(t).toContain(
      'expect(new Decimal(a.balance).comparedTo(new Decimal("14.99"))).toBeGreaterThan(0);',
    );
    expect(t).toContain(
      'expect(new Decimal(a.balance).comparedTo(new Decimal("15"))).not.toBeLessThan(0);',
    );
    expect(t).toContain('import Decimal from "decimal.js";');
  });

  it("node: datetime toBe / ordering compare epoch milliseconds", async () => {
    const t = await file("node", "domain/acct.test.ts");
    expect(t).toContain("expect((a.lastDay)?.getTime()).toBe(new Date(a.lastDay).getTime());");
    expect(t).toContain(
      "expect((a.lastDay)?.getTime()).toBeLessThanOrEqual(new Date(new Date()).getTime());",
    );
  });

  it("elixir: datetime matchers use DateTime.compare, and `now` is DateTime.utc_now()", async () => {
    const t = await file("elixir", "acct_test.exs");
    expect(t).toContain("assert DateTime.compare(a.last_day, a.last_day) == :eq");
    expect(t).toContain("assert DateTime.compare(a.last_day, DateTime.utc_now()) in [:lt, :eq]");
    expect(t).not.toMatch(/last_day: now[,}]/);
  });
});
