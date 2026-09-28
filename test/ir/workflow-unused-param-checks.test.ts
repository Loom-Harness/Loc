// `loom.workflow-param-unused` (F-113) — a command entry's parameter that its
// body never reads.
//
// Found by submitting a claim against a generated backend:
// `create(… firstLine: string, firstAmount: Money)` answered `204`, and the
// claim came back with `lines: []`.  The two params looked like they carried
// the first claim line; the body never mentioned them.  The emitted request
// schema published both as REQUIRED, so the caller was obliged to send data
// the system discarded — and `ddd parse` said `0 error(s), 0 warning(s)`.
//
// The negative cases below are the load-bearing half: three params are unread
// on purpose (an empty body, an event binding, a name-match correlation key)
// and each has a consumer that is not the body.  A gate that flagged those
// would be noise on the corpus' canonical spellings, which is exactly what the
// first cut did — 54 hits, 48 of them one storybook model.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { parseString } from "../_helpers/index.js";

const sys = (members: string) => `
  system S { subdomain M { context C {
    event Filed { claimId: Claim id, at: datetime }
    aggregate Claim with crudish {
      reference: string
      note: string
      operation retag(r: string) { reference := r }
    }
    repository Claims for Claim { }
${members}
  }}}`;

/** Every `loom.workflow-param-unused` message the IR validator raises. */
async function unused(members: string): Promise<string[]> {
  const { model } = await parseString(sys(members), { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.code === "loom.workflow-param-unused")
    .map((d) => d.message);
}

describe("loom.workflow-param-unused", () => {
  it("flags the param a partially-wired create body never reads", async () => {
    const msgs = await unused(`
    workflow file {
      create(reference: string, notes: string) {
        let c = Claim.create({ reference: reference, note: "n" })
      }
    }`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("'notes'");
    expect(msgs[0]).toContain("file.create");
  });

  it("does not flag a param the body DOES read — the control", async () => {
    // Same body, both params consumed.  Without this the gate could be a
    // blanket "a create declares params" and the positive case would still
    // pass.
    expect(
      await unused(`
    workflow file {
      create(reference: string, note: string) {
        let c = Claim.create({ reference: reference, note: note })
      }
    }`),
    ).toEqual([]);
  });

  it("finds a read that only happens inside a nested branch", async () => {
    // The #2720/#2705 shape: a scan of only the TOP-LEVEL statements misses
    // the read and reports a FALSE positive.  This is why the check rides
    // `walk.ts` rather than iterating `entry.statements` itself.
    expect(
      await unused(`
    criterion Open of Claim = note == "open"
    workflow file {
      create(reference: string) {
        if let c = Claims.find(Open) {
          c.retag(reference)
        }
      }
    }`),
    ).toEqual([]);
  });

  it("does not flag a wholly empty body — 'not wired yet', not 'wired wrong'", async () => {
    expect(
      await unused(`
    workflow file {
      create(reference: string, notes: string) { }
    }`),
    ).toEqual([]);
  });

  it("does not flag the event binding of an event-triggered create", async () => {
    // `by e.claimId` routes on `e` in the HEADER; a body that only needs the
    // correlation never reads it.
    expect(
      await unused(`
    workflow react {
      claimId: Claim id
      seen: int
      create(e: Filed) by e.claimId {
        seen := 1
      }
    }`),
    ).toEqual([]);
  });

  it("does not flag the command create's name-match correlation param", async () => {
    // `commandCreateCorrelationParam`: the emitters load-or-allocate the saga
    // row from `claimId` before the first statement runs, so the body never
    // has to mention it.  This is the canonical spelling
    // `test/fixtures/corpus/workflow-create-state.ddd` pins.
    expect(
      await unused(`
    workflow track {
      claimId: Claim id
      status: string
      create(claimId: Claim id) {
        status := "Pending"
      }
    }`),
    ).toEqual([]);
  });

  it("is suppressed on a body an ERROR already broke — no second cascade", async () => {
    // `Claims.getById` is fine here; the refused statement is the point of the
    // sibling `workflow-cross-context-repository.test.ts`, whose own name is
    // "the misleading cascade is gone".  Here the error is an `emit` naming a
    // field the event does not declare — so without the guard the author is
    // told their parameter is unused on top of the mistake they actually made.
    const src = sys(`
    workflow file {
      create(reference: string) {
        emit Filed { nope: 1 }
      }
    }`);
    const { model } = await parseString(src, { validate: false });
    const diags = validateLoomModel(enrichLoomModel(lowerModel(model)));
    expect(diags.some((d) => d.severity === "error")).toBe(true);
    expect(diags.filter((d) => d.code === "loom.workflow-param-unused")).toEqual([]);
  });

  it("still flags a NON-correlation param of a correlated create", async () => {
    // The carve-out is one param wide, not a blanket exemption for saga
    // creates.
    const msgs = await unused(`
    workflow track {
      claimId: Claim id
      status: string
      create(claimId: Claim id, reason: string) {
        status := "Pending"
      }
    }`);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toContain("'reason'");
  });
});
