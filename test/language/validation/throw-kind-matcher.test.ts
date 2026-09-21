import { describe, expect, it } from "vitest";
import { parseString } from "../../_helpers/parse.js";

// ---------------------------------------------------------------------------
// `expect(<call>).toThrow(precondition)` / `.toThrow(invariant)` — the
// discriminating throw assertion, and the four refusals that keep it from
// meaning two different strengths of claim under one name.
//
// THE DEFECT IT EXISTS FOR (audit 2026-09-13, F11).  The audit mutation-probed
// the generated unit tier by deleting a `precondition` from a generated
// aggregate.  The test stayed GREEN: the aggregate's `invariant` threw in its
// place, `toThrow()` cannot tell the two apart, and a test named "a fresh work
// order cannot be completed" went on claiming something it no longer proved.
//
// THE FOUR REFUSALS, each for a DIFFERENT reason — which is why they are four
// codes and not one:
//
//   1. `loom.e2e-throw-kind-invalid` — in a `test e2e` body.  Over HTTP
//      both rungs answer 422 and their only discriminator is the RFC 7807
//      `detail` sentence, which an authored `message` overwrites.  The e2e body
//      keeps the wire-level form, `toThrow(<status>)`.  (This is the same
//      shape #2959 fixed on the ui side, where `toThrow(422)` silently meant
//      something weaker.)
//   2. `loom.throw-kind-outside-tothrow` — anywhere but a `toThrow`.  The
//      grammar's `ThrowKind` slot is reachable on any member call (both words
//      are hard keywords no `CallArg` can carry), so the validator is what
//      keeps the closed matcher catalogue closed.
//
// The other two refusals need the fully-resolved IR (they read the rules of the
// aggregate under test), so they live one phase later —
// `test/ir/throw-kind-tier.test.ts`.
// ---------------------------------------------------------------------------

/** A system with ONE operation carrying BOTH rungs — a `precondition` and a
 *  guarded collection `invariant` that trips on the same call.  This is the
 *  audit's own probe shape: with the precondition gone, the invariant throws
 *  instead, which is precisely what a bare `toThrow()` cannot see. */
const system = (opts: {
  unitBody?: string;
  contextTest?: string;
  e2eTest?: string;
  precondMessage?: string;
  invariantMessage?: string;
}): string => `
  system Probe {
    subdomain Ops {
      context Work {
        enum WorkStatus { Draft, InProgress, Completed }

        aggregate WorkOrder {
          reference: string
          customerName: string
          status: WorkStatus = Draft
          contains tasks: Task[]
          entity Task { label: string }

          invariant tasks.count > 0 when status == Completed${opts.invariantMessage ?? ""}

          create(reference: string, customerName: string, status: WorkStatus) { }

          operation complete() {
            precondition status == InProgress${opts.precondMessage ?? ""}
            status := Completed
          }
${
  opts.unitBody
    ? `
          test "a fresh work order cannot be completed" {
            let wo = WorkOrder.create({ reference: "WO-1", customerName: "Ada", status: Draft })
${opts.unitBody}
          }`
    : ""
}
        }

        repository WorkOrders for WorkOrder { }
${
  opts.contextTest
    ? `
        test "integration" {
          let wo = WorkOrder.create({ reference: "WO-1", customerName: "Ada", status: Draft })
${opts.contextTest}
        }`
    : ""
}
      }
    }
${
  opts.e2eTest
    ? `
    test e2e "wire" against d {
      let wo = api.workOrders.create({ reference: "WO-1", customerName: "Ada", status: Draft })
${opts.e2eTest}
    }`
    : ""
}

    api WorkApi from Ops
    storage primary { type: postgres }
    resource workState { for: Work, kind: state, use: primary }

    deployable d {
      platform: node
      contexts: [Work]
      dataSources: [workState]
      serves: WorkApi
      port: 4000
    }
  }
`;

const codes = async (src: string): Promise<string[]> => {
  const { diagnostics } = await parseString(src);
  return diagnostics.map((d) => String(d.code ?? ""));
};

describe("toThrow(<kind>) — the unit tier can say WHICH rule rejected", () => {
  it("accepts toThrow(precondition) and toThrow(invariant) in a unit test", async () => {
    const { errors } = await parseString(
      system({
        unitBody: `            expect(wo.complete()).toThrow(precondition)`,
      }),
    );
    expect(errors).toEqual([]);

    const both = await parseString(
      system({ unitBody: `            expect(wo.complete()).toThrow(invariant)` }),
    );
    expect(both.errors).toEqual([]);
  });

  it("still accepts the bare toThrow() — the kind form is additive", async () => {
    const { errors } = await parseString(
      system({ unitBody: `            expect(wo.complete()).toThrow()` }),
    );
    expect(errors).toEqual([]);
  });

  it("refuses the kind form in a `test e2e` body, naming the wire-level form", async () => {
    const src = system({
      e2eTest: `      expect(api.workOrders.complete(wo, { })).toThrow(precondition)`,
    });
    expect(await codes(src)).toContain("loom.e2e-throw-kind-invalid");
    const { errors } = await parseString(src);
    // The refusal must NAME the replacement, or it reads as an arbitrary
    // restriction and the author has nowhere to go.
    expect(errors.join("\n")).toContain("toThrow(<status>)");
  });

  it("keeps toThrow(<status>) legal in an e2e body — only the KIND form is refused", async () => {
    const { errors } = await parseString(
      system({ e2eTest: `      expect(api.workOrders.complete(wo, { })).toThrow(422)` }),
    );
    expect(errors).toEqual([]);
  });

  it("refuses a throw-kind word outside toThrow, where it would be dropped", async () => {
    const src = system({
      unitBody: `            expect(wo.reference).toBe(invariant)`,
    });
    const found = await codes(src);
    expect(found).toContain("loom.throw-kind-outside-tothrow");
    // And ONLY that complaint: the word sits in the grammar's `ThrowKind` slot,
    // which is a sibling of `args`, so a naive arity check would also fire
    // "toBe takes 1 argument(s), got 0" and bury the real message.
    const { errors } = await parseString(src);
    expect(errors).toHaveLength(1);
  });
});
