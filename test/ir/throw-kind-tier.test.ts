import { NodeFileSystem } from "langium/node";
import { parseHelper } from "langium/test";
import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { irDiagnosticSourceRef } from "../../src/ir/validate/checks/diagnostic.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { createDddServices } from "../../src/language/ddd-module.js";
import type { Model } from "../../src/language/generated/ast.js";

// ---------------------------------------------------------------------------
// `toThrow(<kind>)` at the IR tier.
//
//   * A rung reads the domain error's STRUCTURAL `kind` on every backend, so a
//     rule's authored `message "..."` costs the assertion nothing — every
//     combination of messaged / message-less rule and rung validates clean.
//   * `loom.throw-kind-integration-unsupported` — the context-integration rung
//     renders through each backend's `integration-tests.ts`, which carries no
//     rung, so the word would be dropped.  It points at the `expect(...)`
//     statement that wrote the rung, not at the enclosing context.
// ---------------------------------------------------------------------------

async function diagsFor(src: string) {
  const services = createDddServices(NodeFileSystem);
  const doc = await parseHelper<Model>(services.Ddd)(src, { validation: true });
  return validateLoomModel(enrichLoomModel(lowerModel(doc.parseResult.value)));
}

async function codesFor(src: string): Promise<string[]> {
  const diags = await diagsFor(src);
  // `LoomDiagnostic.code` is optional, so narrow rather than declaring
  // `string[]` over a `(string | undefined)[]` — the `test/` typecheck ratchet
  // counts that as a new type error, and it only ever shrinks.
  return diags.flatMap((d) => (d.code === undefined ? [] : [d.code]));
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
            let wo = WorkOrder.create(reference: "WO-1", status: Draft)
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
          let wo = WorkOrder.create(reference: "WO-1", status: Draft)
${opts.contextTest}
        }`
    : ""
}
      }
    }
  }
`;

const PRECOND_MESSAGE = ` message "finish the work first"`;
const INVARIANT_MESSAGE = ` message "a completed work order needs at least one task"`;

describe("IR: toThrow(<kind>) is unit-tier only, and reads the rung structurally", () => {
  const messageShapes: ReadonlyArray<
    [string, { precondMessage?: string; invariantMessage?: string }]
  > = [
    ["message-less rules", {}],
    ["a messaged precondition", { precondMessage: PRECOND_MESSAGE }],
    ["a messaged invariant", { invariantMessage: INVARIANT_MESSAGE }],
    [
      "both rules messaged",
      { precondMessage: PRECOND_MESSAGE, invariantMessage: INVARIANT_MESSAGE },
    ],
  ];
  for (const rung of ["precondition", "invariant"] as const) {
    for (const [label, opts] of messageShapes) {
      it(`accepts toThrow(${rung}) against ${label}`, async () => {
        const diags = await diagsFor(
          system({ unitBody: `            expect(wo.complete()).toThrow(${rung})`, ...opts }),
        );
        expect(diags.filter((d) => d.severity === "error").map((d) => d.code)).toEqual([]);
      });
    }
  }

  it("refuses the kind form in a context-integration test, where it would be DROPPED", async () => {
    expect(
      await codesFor(
        system({ contextTest: `          expect(wo.complete()).toThrow(precondition)` }),
      ),
    ).toContain("loom.throw-kind-integration-unsupported");
  });

  it("anchors the context-integration refusal on the offending expect statement", async () => {
    const line = `          expect(wo.complete()).toThrow(precondition)`;
    const src = system({ contextTest: line });
    const diag = (await diagsFor(src)).find(
      (d) => d.code === "loom.throw-kind-integration-unsupported",
    );
    const ref = diag ? irDiagnosticSourceRef(diag) : undefined;
    expect(ref?.kind).toBe("source");
    expect(src.slice(ref?.span.start, ref?.span.end)).toBe(line.trim());
  });

  it("keeps the bare toThrow() legal in a context-integration test", async () => {
    expect(
      await codesFor(system({ contextTest: `          expect(wo.complete()).toThrow()` })),
    ).not.toContain("loom.throw-kind-integration-unsupported");
  });
});
