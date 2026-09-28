// Rule-expression purity (`loom.rule-expr-impure`).
//
// `invariant` / its `when` guard / a field `check` / `derived` are spliced into
// the per-instance floor (`_assertInvariants()`, the derived getter, the wire
// refine), which runs with nothing in scope but `this`.  The language reference
// already states the rule for the sibling construct — a pure `function` "may
// not call a repository / operation / domain-service / extern" — but nothing
// applied it to the four rule positions.
//
// So a cross-aggregate invariant validated clean (`0 error(s), 0 warning(s)`),
// `generate system` exited 0, and the emitted project then failed its OWN
// compiler: `domain/workOrder.ts(37,11): TS2304: Cannot find name 'Technicians'`
// on hono, the same unresolvable symbol on .NET and java, an unbound global on
// python — and on elixir the invariant was emitted NOWHERE at all.
//
// `checkRuleExprPurity` (`src/language/validators/types.ts`) refuses it at the
// source line, in two narrow arms: an unbound head naming an unaddressable
// declaration (repository / aggregate / workflow / api / …), and a call into
// the aggregate's own mutating layer.

import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/index.js";

const parse = (source: string) => parseString(source);

/** The repro's shape, reduced: two aggregates, their repositories, and one
 *  rule position parameterised in. */
const withRule = (rule: string) => `
  system P { subdomain S { context C {
    enum Skill { Electrical, HVAC }
    aggregate Asset { requiredSkill: Skill  derived display: string = "a" }
    aggregate Technician { skills: Skill[]  derived display: string = "t" }
    aggregate WorkOrder {
      assetId: Asset id
      technicianId: Technician id?
      qty: int
      ${rule}
      derived display: string = "w"
    }
    repository Assets for Asset {}
    repository Technicians for Technician {}
    repository WorkOrders for WorkOrder {}
  } } }
`;

describe("validator: rule-expression purity", () => {
  it("refuses a cross-aggregate invariant that reads through a repository", async () => {
    const { errors } = await parse(
      withRule(
        `invariant Technicians.getById(technicianId).skills.contains(Assets.getById(assetId).requiredSkill)`,
      ),
    );
    expect(
      errors.some((e) => /references 'Technicians', which is a repository/.test(e)),
      errors.join("\n"),
    ).toBe(true);
    // BOTH repository heads are named — a report on only the first would leave
    // the author fixing one and hitting the other.
    expect(
      errors.some((e) => /references 'Assets', which is a repository/.test(e)),
      errors.join("\n"),
    ).toBe(true);
  });

  // The finding asked whether `when`, `check` and `derived` share the hole.
  // They do — all four positions lower through the same expression path.
  it("refuses the same reach in an invariant `when` guard", async () => {
    const { errors } = await parse(
      withRule(`invariant qty > 0 when Assets.getById(assetId).requiredSkill == Skill.HVAC`),
    );
    expect(
      errors.some((e) => /invariant guard \('when \.\.\.'\) references 'Assets'/.test(e)),
      errors.join("\n"),
    ).toBe(true);
  });

  it("refuses the same reach in a field `check`", async () => {
    const { errors } = await parse(
      withRule(`n: int check Assets.getById(assetId).requiredSkill == Skill.HVAC`),
    );
    expect(
      errors.some((e) => /check on 'n' references 'Assets'/.test(e)),
      errors.join("\n"),
    ).toBe(true);
  });

  it("refuses the same reach in a `derived`", async () => {
    const { errors } = await parse(
      withRule(`derived skill: string = Assets.getById(assetId).requiredSkill`),
    );
    expect(
      errors.some((e) => /derived 'skill' references 'Assets'/.test(e)),
      errors.join("\n"),
    ).toBe(true);
  });

  it("refuses a workflow name used as a value in an invariant", async () => {
    const { errors } = await parse(`
      system P { subdomain S { context C {
        workflow ship { create(n: int) { precondition n > 0 } }
        aggregate Other { k: int  derived display: string = "o"  invariant ship.k > 0 }
        repository Others for Other {}
      } } }
    `);
    expect(
      errors.some((e) => /references 'ship', which is a workflow/.test(e)),
      errors.join("\n"),
    ).toBe(true);
  });

  it("refuses an invariant that calls the aggregate's own operation", async () => {
    const { errors } = await parse(`
      system P { subdomain S { context C {
        aggregate Item {
          qty: int
          derived display: string = "i"
          operation bump(n: int) { qty := qty + n }
          invariant this.bump(1) == 0
        }
        repository Items for Item {}
      } } }
    `);
    expect(
      errors.some((e) => /calls 'bump', which is an action/.test(e)),
      errors.join("\n"),
    ).toBe(true);
  });

  // NON-VACUITY -------------------------------------------------------------
  // A gate that refuses everything would pass every assertion above.

  it("accepts an ordinary instance-local invariant with ZERO diagnostics", async () => {
    const { errors, warnings } = await parse(`
      system P { subdomain S { context C {
        aggregate Order {
          qty: int
          currency: string
          contains lines: Line[]
          derived display: string = currency
          derived big: bool = qty > 100
          invariant qty > 0
          invariant lines.all(l => l.currency == currency)
          invariant currency.length > 0 when qty > 0
          function ok(): bool = qty > 0
          entity Line { currency: string }
        }
        repository Orders for Order {}
      } } }
    `);
    expect(errors, errors.join("\n")).toEqual([]);
    expect(warnings, warnings.join("\n")).toEqual([]);
  });

  it("still accepts a pure domainService call in an invariant", async () => {
    // Proven emittable: the Hono backend threads `import { Pricing } from
    // "./services"` and renders `Pricing.quote(this._qty)` inside
    // `_assertInvariants()`.  A domain service is a pure calculator, so it is
    // NOT part of this defect and must not be caught by the gate.
    const { errors } = await parse(`
      system P { subdomain S { context C {
        domainService Pricing { operation quote(n: int): int { return n * 2 } }
        aggregate Item {
          qty: int
          derived display: string = "i"
          invariant Pricing.quote(qty) > 0
        }
        repository Items for Item {}
      } } }
    `);
    expect(errors, errors.join("\n")).toEqual([]);
  });

  it("does not fire when a local binding shadows the declaration name", async () => {
    // A lambda parameter named after a repository binds in `env`, so the head is
    // the binding — not the unreachable declaration.  Arm 1 requires BOTH
    // "names an unaddressable declaration" AND "env cannot bind it".
    const { errors } = await parse(`
      system P { subdomain S { context C {
        aggregate Assets { n: int  derived display: string = "a" }
        aggregate Bag {
          contains items: Item[]
          derived display: string = "b"
          invariant items.all(Assets => Assets.k > 0)
          entity Item { k: int }
        }
        repository Bags for Bag {}
      } } }
    `);
    expect(
      errors.some((e) => /rule expression can reach/.test(e)),
      errors.join("\n"),
    ).toBe(false);
  });
});
