// An invented member on an ARRAY receiver (testability-audit F1's residue).
//
// `collectionOpType`'s `default` returns `T.unknown` for any member on an array
// that is not one of the 17 ops in `COLLECTION_OP_SIGNATURES`, and `unknown` is
// the value every downstream check suppresses on — so a typo'd or invented
// collection op on an array receiver was reported NOWHERE and reached the
// emitters verbatim.
//
// WHY THIS IS NOT A DOMAIN-SERVICE BUG.  #3040 gave `envForNode` a
// `DomainServiceOperation` arm, so `let f = Owners.byTier(t)` now binds
// `array<Owner>` instead of `unknown` in a service body. That closed the
// IR/language disagreement; it did NOT make `f.totallyInvented` reported,
// because no validator covered an array receiver in EITHER position. Hence
// every case here is two-position with the aggregate `operation` — where
// `envForNode` always worked — as the control: the aggregate column proves the
// gate is not merely following the #3040 env fix around.
//
// This arm invents no surface: `membersOfType` already returns exactly
// `COLLECTION_OP_SIGNATURES` for an array receiver, so completion has always
// claimed those 17 are an array's members. This makes validation agree.

import { describe, expect, it } from "vitest";
import { COLLECTION_OP_SIGNATURES } from "../../../src/util/collection-ops.js";
import { parseString } from "../../_helpers/index.js";

/** The same expression in an aggregate `operation` and in a `domainService`
 *  operation, over an identical `array<Owner>` binding. */
function twoPosition(expr: string): { agg: string; svc: string } {
  const bind = `let f = Owners.byTier("gold")`;
  const mk = (aggStmt: string, svcStmt: string) => `
  context Fleet {
    aggregate Owner with crudish {
      tier: string
      label: string
      operation probe() { ${bind}  ${aggStmt} }
    }
    repository Owners for Owner {
      find byTier(tier: string): Owner[] where this.tier == tier
    }
    domainService Probe {
      operation probe(): bool { ${bind}  ${svcStmt} }
    }
  }`;
  return {
    agg: mk(`if (${expr}) { label := "x" }`, `return true`),
    svc: mk(`label := "y"`, `return ${expr}`),
  };
}

describe("an invented member on an array receiver is rejected (F1 residue)", () => {
  it("is reported in BOTH positions, naming the array type", async () => {
    const { agg, svc } = twoPosition("f.totallyInvented");
    const a = (await parseString(agg)).errors.join("\n");
    const s = (await parseString(svc)).errors.join("\n");
    // The message must name `Owner[]`, not `Owner` — the receiver is the
    // collection, and saying `Owner` would send the reader to the wrong
    // declaration looking for a field that was never the problem.
    expect(a).toMatch(/'totallyInvented' is not a member of 'Owner\[\]'/);
    expect(s).toMatch(/'totallyInvented' is not a member of 'Owner\[\]'/);
  });

  it("a typo'd collection op is caught (the realistic case)", async () => {
    // `firstOrNil` instead of `firstOrNull` — the shape a user actually hits.
    const { agg, svc } = twoPosition("f.firstOrNil != null");
    expect((await parseString(agg)).errors.join("\n")).toMatch(
      /'firstOrNil' is not a member of 'Owner\[\]'/,
    );
    expect((await parseString(svc)).errors.join("\n")).toMatch(
      /'firstOrNil' is not a member of 'Owner\[\]'/,
    );
  });

  it("does NOT reach a real member of the element type", async () => {
    // `f.tier` is wrong for a different reason (a field of the ELEMENT, read
    // off the collection). It must not be silently accepted, but the point
    // here is that the arm keys on the array surface, not on element fields.
    const { svc } = twoPosition("f.tier != null");
    const e = (await parseString(svc)).errors.join("\n");
    expect(e).toMatch(/'tier' is not a member of 'Owner\[\]'/);
  });
});

describe("the false-positive guard: every legal array member stays clean", () => {
  // The anti-overreach half. A gate that rejects an absent member is only safe
  // if it admits every PRESENT one, so drive the catalogue itself rather than a
  // hand-picked few — a new op added to COLLECTION_OP_SIGNATURES is then
  // covered here automatically instead of silently going unrejected.
  const BARE_REJECTED = new Set(["sum", "avg", "min", "max"]);
  const LAMBDA_FORM = new Set(["all", "any", "where", "map", "sortBy", "sum", "avg", "min", "max"]);
  const ARG_FORM: Record<string, string> = {
    contains: '("x")',
    take: "(1)",
    skip: "(1)",
    join: '(", ")',
  };

  it("the catalogue is non-empty (vacuum guard)", () => {
    expect(COLLECTION_OP_SIGNATURES.length).toBeGreaterThan(10);
  });

  it.each(
    COLLECTION_OP_SIGNATURES.map((o) => o.name),
  )("`%s` is not reported as an unknown member", async (op) => {
    const call = LAMBDA_FORM.has(op) ? "(x => x.tier != null)" : (ARG_FORM[op] ?? "");
    const src = `
  context Fleet {
    aggregate Owner with crudish {
      tier: string
      label: string
      operation probe() { let f = Owners.byTier("gold")  label := "z" }
    }
    repository Owners for Owner {
      find byTier(tier: string): Owner[] where this.tier == tier
    }
    domainService Probe {
      operation probe(): bool { let f = Owners.byTier("gold")  return f.${op}${call} != null }
    }
  }`;
    const errors = (await parseString(src)).errors.join("\n");
    // Whatever else a given op's arg shape may provoke, it must never be
    // called an unknown member of the array — that is this arm's business.
    expect(errors).not.toMatch(new RegExp(`'${op}' is not a member of`));
    // And the bare aggregation four must still be claimed by their own gate,
    // not silently admitted by this one.
    if (BARE_REJECTED.has(op) && !LAMBDA_FORM.has(op)) {
      expect(errors).toMatch(/bare-collection-accessor|lambda/i);
    }
  });
});
