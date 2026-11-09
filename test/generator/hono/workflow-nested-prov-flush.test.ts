// A workflow that calls a provenanced operation on a row it saves INSIDE a
// block — a `for-each` iteration, an `if let` branch — must drain that row's
// lineage into `provenance_records` where the binding is still in scope, right
// after its save.  The exit flush only sees `savesAtExit`, so without the
// block-level flush those writes are silently dropped.
//
// String tier: provenance rows have no wire surface a behavioural leg can read
// back, and the flush is wiring no booted leg observes today.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

const model = `
system OrderingSystem {
  subdomain Ordering {
    context Ordering {
      aggregate Order {
        reference: string
        total: int provenanced
        create(reference: string, total: int)
        operation reprice(price: int) { total := price }
      }
      repository Orders for Order
      criterion RefIs(r: string) of Order = reference == r
      retrieval ByRef(r: string) of Order {
        where: RefIs(r)
      }
      workflow repriceAll transactional {
        create(ref: string, price: int) {
          let xs = Orders.all(ByRef(ref))
          for o in xs {
            o.reprice(price)
          }
        }
      }
      workflow repriceOne {
        create(orderId: Order id, price: int) {
          if let o = Orders.find(orderId) {
            o.reprice(price)
          } else {
            notFound
          }
        }
      }
    }
  }
  storage primary { type: postgres }
  resource orderingState { for: Ordering, kind: state, use: primary }
  deployable d { platform: node, contexts: [Ordering], dataSources: [orderingState], port: 4000 }
}`;

async function workflowsTs(): Promise<string> {
  const files = await generateSystemFiles(model);
  const key = [...files.keys()].find((k) => k.endsWith("http/workflows.ts"));
  expect(key, "http/workflows.ts emitted").toBeDefined();
  return files.get(key!)!;
}

/** The text of one workflow's route, from its started log to the next one. */
function routeOf(file: string, wf: string): string {
  const start = file.indexOf(`workflow: "${wf}"`);
  expect(start, `${wf} route emitted`).toBeGreaterThan(-1);
  const next = file.indexOf(`event: "workflow_started"`, start + 1);
  return file.slice(start, next === -1 ? undefined : next);
}

describe("node workflow — provenance flush for a save inside a block", () => {
  it("a for-each iteration's save drains the row's lineage on the transaction, inside the loop", async () => {
    const route = routeOf(await workflowsTs(), "repriceAll");
    expect(route).toMatch(
      /for \(const o of xs\) \{\s*o\.reprice\(price\);\s*await orders\.save\(o\);\s*const reqCtx = requestContext\(\);\s*for \(const t of o\.drainProv\(\)\) \{\s*await tx\.insert\(schema\.provenanceRecords\)/,
    );
    expect(route).toContain("await runInChildContext(async () => {");
  });

  it("an if-let branch's save drains the row's lineage inside the branch", async () => {
    const route = routeOf(await workflowsTs(), "repriceOne");
    expect(route).toMatch(
      /if \(o !== null\) \{\s*o\.reprice\(price\);\s*await orders\.save\(o\);\s*const reqCtx = requestContext\(\);\s*for \(const t of o\.drainProv\(\)\) \{\s*await db\.insert\(schema\.provenanceRecords\)/,
    );
    expect(route).toContain("await runInChildContext(async () => {");
  });
});
