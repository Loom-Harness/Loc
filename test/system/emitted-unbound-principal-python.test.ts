// The scope invariant on the ONE backend with no compiler behind it.
//
// `test/system/emitted-unbound-identifiers.test.ts` asks "does the emitted code
// reference a name it never brought into scope?" of the react page matrix.
// This asks the same question of emitted Python, using the same helper
// (`test/_helpers/emitted-scope.ts`) — read its header for why the backend half
// is Python-only and why the unit here is the `def`, not the file.
//
// Short version: node/.NET/Java/Elixir all reject an unbound name at compile
// time, so their build gates already are this check.  `python -m compileall`
// does not — Python binds at execution — so an emitted `current_user.id` in a
// method that declares no `current_user` is a VALID module that raises
// `NameError` on the first request.  That is F-013, and every gate on its PR
// was green.
//
// THE MATRIX is the set of read paths a principal-referencing predicate can
// reach, because the defect was path-specific: a `find` threads the principal as
// a parameter and was always correct, while a `retrieval` and a query-time
// projection have DSL-fixed signatures that take none.  Any future read path
// that forgets the ambient accessor lands here the same way.
//
// NON-VACUITY is asserted twice: each case requires the generation to have
// emitted something, and a separate case requires the sweep to have actually
// REACHED principal-reading functions — otherwise all of it passes on a tree
// where nothing mentions the principal at all.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PY_PRINCIPAL_SCOPE,
  pyReferencingUnits,
  unboundPyReferences,
} from "../_helpers/emitted-scope.js";
import { generateSystemFiles } from "../_helpers/index.js";

/** A python system whose `body` is dropped into one context.  `auth: required`
 *  + a system `user {}` block are what make `currentUser` resolvable at all. */
function system(body: string): string {
  return `system Acme {
  user { id: string  tenantId: string }
  subdomain Core {
    context Ops {
      aggregate WorkOrder with crudish {
        title: string
        technicianUserId: string
        tenantId: string
        amount: decimal
      }
${body}
    }
  }
  api OpsApi from Core
  storage primary { type: postgres }
  resource opsState { for: Ops, kind: state, use: primary }
  deployable opsSvc {
    platform: python  contexts: [Ops]  dataSources: [opsState]  serves: OpsApi  auth: required  port: 3000
  }
}`;
}

/** One read path that can carry a principal-referencing predicate. */
const READ_PATHS: readonly { readonly what: string; readonly body: string }[] = [
  {
    what: "a retrieval over a currentUser criterion (F-013's own shape)",
    body: `      criterion Mine() of WorkOrder = this.technicianUserId == currentUser.id
      retrieval MyOrders() of WorkOrder { where: Mine()  sort: [title desc] }
      repository WorkOrders for WorkOrder { }`,
  },
  {
    what: "a retrieval whose where is a COMPOSED principal predicate",
    body: `      criterion Mine() of WorkOrder = this.technicianUserId == currentUser.id
      criterion Big() of WorkOrder = this.amount > 100
      retrieval MyBigOrders() of WorkOrder { where: Mine() && Big() }
      repository WorkOrders for WorkOrder { }`,
  },
  {
    // The ROW-returning query-time projection — a DIFFERENT emitter from the
    // aggregating one below.  This one becomes a method on the repository
    // (`viewFindMethod`), whose signature is as parameter-free as a
    // retrieval's; the aggregating one becomes a direct-table read in a ROUTE,
    // which binds `current_user: User` off the request scope.  Both are here
    // because "query-time projection" is one DSL construct and two code paths.
    what: "a ROW-returning query-time projection filtered by the principal",
    body: `      projection MyRows {
        title: string
        from WorkOrder as w
        where w.technicianUserId == currentUser.id
        select title = w.title
      }
      repository WorkOrders for WorkOrder { }`,
  },
  {
    what: "an AGGREGATING query-time projection filtered by the principal",
    body: `      projection MyTotals {
        orders: int
        from WorkOrder as w
        where w.technicianUserId == currentUser.id
        select orders = count
      }
      repository WorkOrders for WorkOrder { }`,
  },
  {
    what: "an always-on capability filter (the path that was already correct)",
    body: `      repository WorkOrders for WorkOrder { }`,
  },
  {
    what: "a find that DECLARES the principal (its parameter is the binding)",
    body: `      repository WorkOrders for WorkOrder {
        find mine(): WorkOrder[] where technicianUserId == currentUser.id
      }`,
  },
  {
    // THE CASE THAT JUSTIFIES THE PER-`def` UNIT.  Both reads land in one
    // repository module: the find's method binds `current_user: User`, so the
    // FILE contains a binding and a file-level check reads green — while the
    // retrieval's method, two defs down, binds nothing.  Only a per-function
    // unit separates them, and reverting the fix must still fail HERE.
    what: "a find and a retrieval in the SAME repository module",
    body: `      criterion Mine() of WorkOrder = this.technicianUserId == currentUser.id
      retrieval MyOrders() of WorkOrder { where: Mine() }
      repository WorkOrders for WorkOrder {
        find mine(): WorkOrder[] where technicianUserId == currentUser.id
      }`,
  },
];

describe("emitted Python never reads `current_user` in a def that never bound it", () => {
  for (const { what, body } of READ_PATHS) {
    it(what, async () => {
      const files = await generateSystemFiles(system(body));
      expect(files.size, `${what}: generation emitted nothing`).toBeGreaterThan(0);

      expect(
        unboundPyReferences(files, PY_PRINCIPAL_SCOPE),
        `${what}: emitted Python reads ${PY_PRINCIPAL_SCOPE.label} in a function that binds ` +
          `no such name (ruff F821; NameError on the first request)`,
      ).toEqual([]);
    }, 60_000);
  }

  // The capability-filter case AND the aggregate-level `filter` case in one:
  // `tenantOwned`-shaped row scoping is the compiler-generated predicate that
  // was always correct, and it must stay correct next to a hand-written one.
  it("a hand-written capability filter alongside a principal retrieval", async () => {
    const files = await generateSystemFiles(
      system(`      criterion Mine() of WorkOrder = this.technicianUserId == currentUser.id
      retrieval MyOrders() of WorkOrder { where: Mine() }
      repository WorkOrders for WorkOrder { }`).replace(
        "        amount: decimal",
        "        amount: decimal\n        filter this.tenantId == currentUser.tenantId",
      ),
    );
    expect(files.size).toBeGreaterThan(0);
    expect(unboundPyReferences(files, PY_PRINCIPAL_SCOPE)).toEqual([]);
  }, 60_000);

  it("the repo's own python example (showcase.ddd) is clean too", async () => {
    const files = await generateSystemFiles(readFileSync("examples/showcase.ddd", "utf8"));
    expect(files.size).toBeGreaterThan(0);
    expect(unboundPyReferences(files, PY_PRINCIPAL_SCOPE)).toEqual([]);
  }, 120_000);

  // NON-VACUITY.  Every case above passes trivially on a tree where no emitted
  // function mentions the principal at all — including one where generation
  // silently produced no python.  Anchor the sweep to the exact function F-013
  // was found in: it must READ the principal, and it must read it through the
  // ambient accessor rather than a free name.
  it("the sweep actually reaches principal-reading functions (else it is vacuous)", async () => {
    const files = await generateSystemFiles(
      system(`      criterion Mine() of WorkOrder = this.technicianUserId == currentUser.id
      retrieval MyOrders() of WorkOrder { where: Mine() }
      repository WorkOrders for WorkOrder {
        find mine(): WorkOrder[] where technicianUserId == currentUser.id
      }`),
    );
    const reading = pyReferencingUnits(files, PY_PRINCIPAL_SCOPE);
    expect(
      reading,
      "no emitted python function reads the principal — the sweep is vacuous",
    ).not.toEqual([]);
    // The find's method is the one that legitimately binds it as a parameter.
    expect(reading.some((u) => u.endsWith(":: mine"))).toBe(true);
    // …and the retrieval's method, which binds nothing, must therefore NOT
    // appear as a bare reader: it goes through `require_current_user()`.
    const repo = files.get("ops_svc/app/db/repositories/work_order_repository.py");
    expect(repo).toBeDefined();
    expect(repo!).toContain("require_current_user().id");
  }, 60_000);
});
