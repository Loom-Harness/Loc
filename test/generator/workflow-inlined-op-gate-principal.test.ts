// ---------------------------------------------------------------------------
// A workflow that calls a `requires`-gated operation must BIND a principal,
// even though its own body never spells `currentUser`.
//
// A `requires` gate is HOISTED out of the entity (`operationGates`), so the
// CALLER owns it: an inline `wo.schedule(…)` inside a workflow renders the
// gate at the call site, and that rendered gate reads
// `currentUser.permissions…`.  Every backend gated the principal parameter on
// a predicate that inspected only the WORKFLOW's own expressions, so the
// generated method named a symbol it never bound — javac `cannot find symbol`,
// C# CS0103 — from a `.ddd` that validated `0 error(s), 0 warning(s)`.
//
// `workflowNeedsCurrentUser` (`src/ir/util/op-gates.ts`) is the one rule, and
// it rides `walkWorkflowStmtsDeep` rather than naming the nesting kinds by
// hand: the per-backend copies it replaces descended into `for-each` only, or
// `for-each` + `if-let`, so an op-call one level deeper was invisible.  The
// NESTED fixture below is what holds that honest — a flat call alone passes
// against a hand-rolled recursion.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/index.js";

/** The exact reported shape: a `let wo = Repo.getById(…)` repo bind — which
 *  lowers to an `if-let` — with the gated `wo.annotate(…)` call INSIDE its
 *  body.  The workflow's own statement list therefore contains no `op-call` at
 *  all, which is what every per-backend hand-rolled recursion missed. */
const system = (platform: string): string => `
  system Field {
    user {
      id: string
      email: string
      permissions: string[]
    }
    auth {
      enforcement: opt
      oidc { issuer: env("OIDC_ISSUER")  clientId: env("OIDC_CLIENT_ID") }
    }
    subdomain Ops {
      permissions {
        dispatch
      }
      context Work {
        aggregate Tech with crudish {
          name: string
          derived display: string = name
        }
        repository Techs for Tech { }
        aggregate WorkOrder with crudish {
          title: string
          note: string
          derived display: string = title
          operation annotate(memo: string) requires currentUser.permissions.contains(permissions.dispatch) {
            note := memo
          }
        }
        repository WorkOrders for WorkOrder { }
        workflow annotateOrders {
          create(target: WorkOrder id, memo: string) {
            let wo = WorkOrders.getById(target)
            wo.annotate(memo)
          }
        }
      }
    }
    api OpsApi from Ops
    storage primary { type: postgres }
    resource workState { for: Work, kind: state, use: primary }
    deployable api {
      platform: ${platform}, contexts: [Work], dataSources: [workState],
      serves: OpsApi, port: 4300, auth: required
    }
  }
`;

async function sourceFor(platform: string, suffix: string): Promise<string> {
  const files = await generateSystemFiles(system(platform));
  return [...files.entries()]
    .filter(([p]) => p.endsWith(suffix))
    .map(([, c]) => c)
    .join("\n");
}

describe("a workflow's inlined op gate binds the principal it reads", () => {
  it("java: the workflow method that renders the gate also binds currentUser", async () => {
    const src = await sourceFor("java", "Workflows.java");
    const wf = src.slice(src.indexOf("public void annotateOrders("));
    // The hoisted gate reaches the workflow body…
    expect(wf).toContain("currentUser.permissions().contains(");
    // …and the principal is BOUND above it, rather than being a free symbol
    // javac reports as "cannot find symbol".
    expect(wf.slice(0, wf.indexOf("currentUser.permissions()"))).toContain(
      "var currentUser = currentUserAccessor.user();",
    );
  });

  it("dotnet: the handler that renders the gate also binds the principal", async () => {
    const src = await sourceFor("dotnet", ".cs");
    const handler = src.slice(src.indexOf("AnnotateOrdersHandler"));
    expect(handler).toMatch(/currentUser/i);
    // The principal arrives as a bound name (parameter / local), never as a
    // bare identifier the gate alone introduces.
    expect(handler).toMatch(/(CurrentUser\s*\??\s*currentUser|var currentUser\s*=)/);
  });
});
