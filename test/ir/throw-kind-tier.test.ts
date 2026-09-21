import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { createDddServices } from "../../src/language/ddd-module.js";
import type { Model } from "../../src/language/generated/ast.js";

// ---------------------------------------------------------------------------
// The two `toThrow(<kind>)` refusals that need the fully-resolved IR, because
// each has to read the RULES of the aggregate under test — which operation is
// being called, and whether the rule that would reject it still carries the
// derived message prefix the four prefix-reading backends discriminate on.
//
//   * `loom.throw-kind-custom-message` — an authored `message "..."` REPLACES
//     that prefix (`message ?? \`Precondition failed: …\`` on all four), so the
//     very clause that makes a rule legible to a human makes it illegible to
//     this matcher.  Elixir alone escapes, being structural (`GuardError` is
//     `defexception [:message, :kind]`) — but a unit `test` is emitted for ALL
//     FIVE backends from one `.ddd`, so a shape four cannot express is not
//     writable portably.  The structural fix for those four is filed as its own
//     mission (design M-T5.36 § 2a, decision 7).
//   * `loom.throw-kind-integration-unsupported` — the context-integration rung
//     renders through each backend's `integration-tests.ts`, which carries no
//     rung.  MEASURED, not assumed: before this gate the node leg emitted
//     `await expect(async () => { wo.complete(); }).rejects.toThrow()` — the
//     author's `precondition` silently gone and the claim silently weaker,
//     which is the exact defect class this matcher was built to remove.
// ---------------------------------------------------------------------------

async function codesFor(src: string): Promise<string[]> {
  const services = createDddServices(NodeFileSystem);
  const doc = await parseHelper<Model>(services.Ddd)(src, { validation: true });
  const diags = validateLoomModel(enrichLoomModel(lowerModel(doc.parseResult.value)));
  return diags.map((d) => d.code);
}

/** The audit's probe shape: ONE operation carrying BOTH rungs, so that deleting
 *  the `precondition` leaves the `invariant` to throw in its place. */
const system = (opts: {
  unitBody?: string;
  contextTest?: string;
  precondMessage?: string;
  invariantMessage?: string;
}): string => `
  system Probe {
    subdomain Ops {
      context Work {
        enum WorkStatus { Draft, InProgress, Completed }

        aggregate WorkOrder {
          reference: string
          status: WorkStatus = Draft
          contains tasks: Task[]
          entity Task { label: string }

          invariant tasks.count > 0 when status == Completed${opts.invariantMessage ?? ""}

          create(reference: string, status: WorkStatus) { }

          operation complete() {
            precondition status == InProgress${opts.precondMessage ?? ""}
            status := Completed
          }
${
  opts.unitBody
    ? `
          test "probe" {
            let wo = WorkOrder.create({ reference: "WO-1", status: Draft })
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
          let wo = WorkOrder.create({ reference: "WO-1", status: Draft })
${opts.contextTest}
        }`
    : ""
}
      }
    }
  }
`;

describe("IR: toThrow(<kind>) is unit-tier only, and needs a readable rule", () => {
  it("accepts both rungs against rules that keep their derived message", async () => {
    expect(
      await codesFor(
        system({ unitBody: `            expect(wo.complete()).toThrow(precondition)` }),
      ),
    ).not.toContain("loom.throw-kind-custom-message");
    expect(
      await codesFor(system({ unitBody: `            expect(wo.complete()).toThrow(invariant)` })),
    ).not.toContain("loom.throw-kind-custom-message");
  });

  it("refuses toThrow(precondition) when THAT operation's precondition is messaged", async () => {
    expect(
      await codesFor(
        system({
          unitBody: `            expect(wo.complete()).toThrow(precondition)`,
          precondMessage: ` message "finish the work first"`,
        }),
      ),
    ).toContain("loom.throw-kind-custom-message");
  });

  it("refuses toThrow(invariant) when the aggregate's invariant is messaged", async () => {
    expect(
      await codesFor(
        system({
          unitBody: `            expect(wo.complete()).toThrow(invariant)`,
          invariantMessage: ` message "a completed work order needs at least one task"`,
        }),
      ),
    ).toContain("loom.throw-kind-custom-message");
  });

  it("does not cross the rungs — a messaged INVARIANT leaves toThrow(precondition) alone", async () => {
    // The gate resolves the rule the AUTHOR'S rung names, not "any messaged
    // rule anywhere".  Without this the gate would refuse perfectly readable
    // assertions on any aggregate that happens to carry one messaged rule.
    expect(
      await codesFor(
        system({
          unitBody: `            expect(wo.complete()).toThrow(precondition)`,
          invariantMessage: ` message "a completed work order needs at least one task"`,
        }),
      ),
    ).not.toContain("loom.throw-kind-custom-message");
  });

  it("leaves the bare toThrow() alone when a rule carries a custom message", async () => {
    // The refusal is about READING a rung off a prefix.  A bare `toThrow()`
    // reads no prefix, so a messaged rule is none of its business — a gate that
    // fired here would break existing models for no benefit.
    expect(
      await codesFor(
        system({
          unitBody: `            expect(wo.complete()).toThrow()`,
          precondMessage: ` message "finish the work first"`,
        }),
      ),
    ).not.toContain("loom.throw-kind-custom-message");
  });

  it("refuses the kind form in a context-integration test, where it would be DROPPED", async () => {
    expect(
      await codesFor(
        system({ contextTest: `          expect(wo.complete()).toThrow(precondition)` }),
      ),
    ).toContain("loom.throw-kind-integration-unsupported");
  });

  it("keeps the bare toThrow() legal in a context-integration test", async () => {
    expect(
      await codesFor(system({ contextTest: `          expect(wo.complete()).toThrow()` })),
    ).not.toContain("loom.throw-kind-integration-unsupported");
  });
});
