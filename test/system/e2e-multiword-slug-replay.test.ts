// A multi-word aggregate in an `api.<slug>` e2e call must resolve to its
// context — or the multi-backend replay picks deployables that cannot host it.
//
// `renderE2EFile` replays each `test e2e … against <d>` on every BACKEND
// deployable whose contexts cover the aggregates the body touches.  The cover
// check asks `findContextForSlug` which context owns each referenced slug, and
// that function accepted ONE spelling (`snake(plural(name))`) while
// `findAggregateBySlug` — the function that later resolves the same slug
// against the chosen deployable — accepted THREE.
//
// For a single-word aggregate the two agree by accident (`Bar` is `bars` under
// both), which is why 67 corpus fixtures never saw it.  For a multi-word one
// they diverge — `workOrders` vs `work_orders` — so the cover check found no
// owning context, `requiredContexts` stayed EMPTY, `every()` over an empty set
// was vacuously true for every backend, and the test was replayed against a
// deployable hosting a different context entirely.  There `findAggregateBySlug`
// threw, and `ddd generate` exited with a raw Node stack trace on a model that
// had just printed `0 error(s), 0 warning(s)` (F-012).
//
// The two matchers are now one predicate.  This pins the behaviour that
// mattered: the replay set, not the spelling.
import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../_helpers/generate.js";

/** Two contexts, two backend deployables, and a multi-word aggregate hosted by
 *  only one of them — the shape the corpus lacked. */
const SRC = `
system X {
  subdomain S {
    context A {
      aggregate WorkOrder with crudish { name: string  derived display: string = name }
      repository WorkOrders for WorkOrder { }
    }
    context B {
      aggregate Bar with crudish { tag: string  derived display: string = tag }
      repository Bars for Bar { }
    }
  }
  storage p { type: postgres }
  resource ra { for: A, kind: state, use: p }
  resource rb { for: B, kind: state, use: p }
  deployable api   { platform: node, contexts: [A], dataSources: [ra], port: 3000 }
  deployable other { platform: node, contexts: [B], dataSources: [rb], port: 3002 }

  test e2e "create a work order" against api {
    let f = api.workOrders.create({ name: "x" })
    let read = api.workOrders.getById(f)
    expect(read.name).toBe("x")
  }
}
`;

/** The same system with a SINGLE-WORD aggregate, where the two spellings
 *  coincide.  It passed before the fix and must still pass — the control that
 *  shows the fix changed the multi-word case and nothing else. */
const SINGLE_WORD = SRC.replace(/WorkOrder/g, "Order")
  .replace(/WorkOrders/g, "Orders")
  .replace(/api\.workOrders/g, "api.orders")
  .replace("create a work order", "create an order");

describe("e2e replay resolves a multi-word aggregate slug", () => {
  it("generates at all (it used to throw out of the renderer)", async () => {
    const files = await generateSystemFiles(SRC);
    const spec = [...files].find(([p]) => p.endsWith("e2e/X.e2e.test.ts"))?.[1];
    expect(spec, "no e2e spec emitted").toBeDefined();
  });

  it("replays ONLY against the deployable that hosts the aggregate", async () => {
    const files = await generateSystemFiles(SRC);
    const spec = [...files].find(([p]) => p.endsWith("e2e/X.e2e.test.ts"))![1];
    const replays = [...spec.matchAll(/it\("create a work order against (\w+)"/g)].map(
      (m) => m[1]!,
    );
    // Precisely: `api` and not `other`.  Asserting only "does not contain
    // other" would pass on a spec with no test in it at all.
    expect(replays).toEqual(["api"]);
  });

  it("the single-word control is unchanged", async () => {
    const files = await generateSystemFiles(SINGLE_WORD);
    const spec = [...files].find(([p]) => p.endsWith("e2e/X.e2e.test.ts"))![1];
    const replays = [...spec.matchAll(/it\("create an order against (\w+)"/g)].map((m) => m[1]!);
    expect(replays).toEqual(["api"]);
  });
});
