// `loom.aggregate-not-constructible` (F-114) — an aggregate no code path can
// bring into existence.
//
// Found while building a claims system: `aggregate Policy { … }` validated
// `0 error(s), 0 warning(s)`, got a table, a repository and a read-only route
// set, and answered `405` to `POST /api/policies`.  The compiler already knew
// — the ui scaffold omits the "new" page for exactly this aggregate — and
// said nothing.
//
// ADVISORY rather than a warning: the shape is legal and sometimes deliberate
// (a table fed by a migration or an out-of-band importer; a fixture whose
// subject is table emission, not routes).  So the load-bearing half of this
// suite is the six negatives: every construction path the checker credits,
// each one proven separately, because an advisory that cries wolf gets muted
// and then the true positives go with it.

import { describe, expect, it } from "vitest";
import { isAdvisoryCode } from "../../src/diagnostics/advisory.js";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/index.js";

const sys = (members: string) => `
  system S { subdomain M { context C {
    event Opened { policyId: Policy id, at: datetime }
${members}
  }}}`;

/** The aggregate names `loom.aggregate-not-constructible` names. */
async function flagged(members: string): Promise<string[]> {
  const { model } = await parseString(sys(members), { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.code === "loom.aggregate-not-constructible")
    .map((d) => (d.source ?? "").split("/")[1] ?? "");
}

describe("loom.aggregate-not-constructible", () => {
  it("flags the aggregate nothing can create, and not the one beside it", async () => {
    // The `with crudish` sibling is the control: a gate that flagged both
    // would be "this model has aggregates", not a construction-path check.
    expect(
      await flagged(`
    aggregate Claim with crudish { reference: string }
    repository Claims for Claim { }
    aggregate Policy { code: string }
    repository Policies for Policy { }`),
    ).toEqual(["Policy"]);
  });

  it("rides the advisory Suggestions channel, not the warning count", async () => {
    // The severity IS the design (see the check's header).  Pinning it here
    // means a later move onto the warning count has to be deliberate.
    expect(isAdvisoryCode("loom.aggregate-not-constructible")).toBe(true);
  });

  it("credits a declared create", async () => {
    expect(
      await flagged(`
    aggregate Policy {
      code: string
      create open(c: string) { code := c }
    }
    repository Policies for Policy { }`),
    ).toEqual([]);
  });

  it("credits a workflow that builds one", async () => {
    expect(
      await flagged(`
    aggregate Policy { code: string }
    repository Policies for Policy { }
    workflow issue {
      create(code: string) {
        let p = Policy.create({ code: code })
      }
    }`),
    ).toEqual([]);
  });

  it("credits a build nested inside a branch, not just a top-level one", async () => {
    // A top-level-only scan of the workflow body reports a FALSE positive
    // here.  This is why the predicate rides `walk.ts`.
    expect(
      await flagged(`
    aggregate Claim with crudish { reference: string  code: string }
    repository Claims for Claim { }
    criterion Open of Claim = code == "open"
    aggregate Policy { code: string }
    repository Policies for Policy { }
    workflow issue {
      create(code: string) {
        if let c = Claims.find(Open) {
          let p = Policy.create({ code: code })
        }
      }
    }`),
    ).toEqual([]);
  });

  it("credits a top-level commandHandler that builds one", async () => {
    expect(
      await flagged(`
    aggregate Policy { code: string }
    repository Policies for Policy { }
    commandHandler Issue(code: string): string {
      let p = Policy.create({ code: code })
      return code
    }`),
    ).toEqual([]);
  });

  it("credits an event-fold applier — the row is never inserted by a route", async () => {
    expect(
      await flagged(`
    aggregate Policy {
      code: string
      apply(e: Opened) { code := "opened" }
    }
    repository Policies for Policy { }`),
    ).toEqual([]);
  });

  it("credits a seed row", async () => {
    expect(
      await flagged(`
    aggregate Policy { code: string }
    repository Policies for Policy { }
    seed defaults { Policy { code: "STD" } }`),
    ).toEqual([]);
  });

  it("does not flag a CONCRETE base its subtype constructs", async () => {
    // Separate from the abstract case below, and deliberately so: `Vehicle`
    // declares no create of its own and is not abstract, so only the
    // "something extends me" rule keeps it quiet.
    expect(
      await flagged(`
    aggregate Vehicle inheritanceUsing: sharedTable { vin: string }
    aggregate Car extends Vehicle with crudish { doors: int }`),
    ).toEqual([]);
  });

  it("does not flag an abstract base or one a subtype extends", async () => {
    // Creating the subtype writes the base's row under both TPH and TPC, so
    // neither `Party` (abstract) nor `Person` (a declared base) is a dead end.
    // `Ghost` is the control — a leaf subtype with no create of its own.
    expect(
      await flagged(`
    abstract aggregate Party inheritanceUsing: sharedTable { label: string }
    aggregate Person extends Party with crudish { name: string }
    aggregate Ghost extends Party { spooky: bool }`),
    ).toEqual(["Ghost"]);
  });
});
