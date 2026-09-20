// `api.workflows.<name>(body?)` — the reserved-slug workflow call.
//
// THE SPLIT BRAIN THIS CLOSES.  The reserved slug had a validator arm and no
// renderer arm.  `test-checks.ts` resolved `api.workflows.<name>(…)` against
// every context's workflows and returned with NO diagnostic; `renderApiCall`
// had no matching case, so the call fell through to the aggregate lookup.
// Measured on `test/fixtures/corpus/workflow-command-payload.ddd` plus a body
// following `docs/workflow.md`:
//
//     $ ddd parse …             → 0 error(s), 0 warning(s).  OK
//     $ ddd generate system …
//     Error: e2e: unknown aggregate 'api.workflows' on this deployable.
//         at renderApiCall (out/system/e2e-render.js:612:15)
//
// An unhandled generator Error with a stack trace, on a source the compiler
// had just certified — exactly the class `loom.e2e-unaddressable-call` was
// minted for, one level in.  The two layers now agree: the renderer emits the
// POST the backends mount, and the route-contract check refuses the one
// workflow shape that mounts nothing.
//
// THE ROUTE IS NOT A GUESS.  `POST <apiBase>/workflows/<snake(wf.name)>` is
// what all five backends emit — hono `workflow-builder.ts` (`path:
// "/<snake>"` under `app.route("/api/workflows", …)`), python's
// `workflows_routes.py`, java's `<Ctx>WorkflowsController`, elixir's
// `router.ex`, .NET's workflow controller — and the route answers 204 with an
// empty body, which `__post` already returns as `{}`.  Proven at RUNTIME while
// this landed: a temporary block on `workflow-command-payload` booted on the
// node behavioural leg and recorded `POST /api/workflows/claim_handling` 204
// followed by the created `Claim` reading back through `api.claim.all()`.
//
// The EVENT-triggered half is a refusal, not an emission: `emitsCommandRoute`
// (`src/ir/util/workflow-command-route.ts`) is the predicate every backend
// gates the POST on, so a reactor started by the in-process dispatcher mounts
// nothing and a caller must be told rather than shipped a 404.

import { describe, expect, it } from "vitest";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/index.js";
import { toLoomModel } from "../_helpers/ir.js";
import { parseString } from "../_helpers/parse.js";

const COMMAND_WF = `
  system Intake {
    subdomain D {
      context Claims {
        aggregate Claim with crudish {
          description: string
        }
        repository Claims for Claim { }
        workflow ClaimHandling {
          create(description: string) {
            let c = Claim.create({ description: description })
          }
        }
      }
    }
    api A from D
    storage pg { type: postgres }
    resource s { for: Claims, kind: state, use: pg }
    deployable d {
      platform: node contexts: [Claims] dataSources: [s] serves: A port: 4000
    }
    test e2e "run the workflow" against d {
      api.workflows.claimHandling({ description: "d" })
      let filed = api.claim.all()
      expect(filed.total).toBe(1)
    }
  }
`;

const EVENT_WF = `
  system Reactor {
    subdomain D {
      context Claims {
        aggregate Claim with crudish {
          reference: string
        }
        repository Claims for Claim { }
        event ClaimFiled { claim: Claim id, at: datetime }
        workflow Review {
          claim: Claim id
          create(e: ClaimFiled) by e.claim { }
        }
      }
    }
    api A from D
    storage pg { type: postgres }
    resource s { for: Claims, kind: state, use: pg }
    deployable d {
      platform: node contexts: [Claims] dataSources: [s] serves: A port: 4000
    }
    test e2e "run the reactor" against d {
      api.workflows.review({ claim: "x" })
    }
  }
`;

async function codesOf(src: string): Promise<string[]> {
  const { model, errors } = await parseString(src);
  expect(errors).toEqual([]);
  return validateLoomModel(toLoomModel(model)).map((d) => d.code);
}

describe("e2e `api.workflows.<name>` — the command route", () => {
  it("renders POST <apiBase>/workflows/<snake(name)> with the body", async () => {
    const files = await generateSystemFiles(COMMAND_WF);
    const e2e = files.get("e2e/Intake.e2e.test.ts") as string;
    expect(e2e).toContain(
      'await __post(`${base}/api/workflows/claim_handling`, ({ description: "d" }))',
    );
  });

  it("emits the POST the BACKEND mounts, path for path", async () => {
    // The two halves of the same compilation, compared rather than asserted
    // against a literal: whatever path the hono workflow router registers is
    // the path the e2e suite must call.
    const files = await generateSystemFiles(COMMAND_WF);
    const routes = files.get("d/http/workflows.ts") as string;
    expect(routes).toContain('path: "/claim_handling"');
    expect(files.get("d/http/index.ts")).toContain('app.route("/api/workflows", workflowsRoutes(');
    expect(files.get("e2e/Intake.e2e.test.ts")).toContain("`${base}/api/workflows/claim_handling`");
  });

  it("validates clean AND generates — the two layers no longer disagree", async () => {
    // The regression pin.  Before this arm the same source validated with zero
    // diagnostics and then threw out of `renderApiCall`; asserting BOTH in one
    // test is what makes the split brain impossible to reintroduce silently.
    expect(await codesOf(COMMAND_WF)).toEqual([]);
    await expect(generateSystemFiles(COMMAND_WF)).resolves.toBeDefined();
  });
});

describe("e2e `api.workflows.<name>` — the refusals", () => {
  it("refuses an EVENT-triggered workflow, which mounts no POST", async () => {
    const codes = await codesOf(EVENT_WF);
    expect(codes).toContain("loom.e2e-unrouted-verb");
    // And the emitted project agrees: no command route for it to call.  The
    // same system MINUS the refused block, so the assertion reads a project a
    // user can actually obtain.
    const noCaller = EVENT_WF.replace(/ {4}test e2e[\s\S]*?\n {4}\}\n/, "");
    expect(noCaller).not.toContain("api.workflows");
    const files = await generateSystemFiles(noCaller);
    expect(files.get("d/http/workflows.ts")).not.toContain('path: "/review"');
  });

  it("still names an unknown workflow", async () => {
    const typo = COMMAND_WF.replace("api.workflows.claimHandling(", "api.workflows.nosuch(");
    expect(await codesOf(typo)).toContain("loom.e2e-unknown-workflow");
  });
});
