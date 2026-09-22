// F-007 — `criterion Assigned() of WorkOrder = this.technicianId != null`
// emitted `ne(schema.workOrders.technicianId, null)`, and the generated project
// failed `tsc`:
//
//   error TS2769: No overload matches this call.
//     Argument of type 'null' is not assignable to parameter of type
//     'string | SQLWrapper'.
//
// Drizzle types `eq`/`ne` as `(column, column | value)` and `null` is not in
// that value union — because SQL has no `= NULL`.  `isNull`/`isNotNull` are the
// exports for exactly this test.  `ddd parse` reported 0 errors, so the shape
// reached codegen unremarked; "not yet assigned" / "not yet invoiced" is
// everywhere in a real schema, so this is not an exotic corner.
//
// The null form is checked on BOTH sides of the comparison and under
// parentheses, because the fix keys off a shared recogniser
// (`nullComparison`, src/ir/util/comparison-operands.ts) whose whole job is to
// see the literal wherever it sits.
//
// NON-VACUITY: an ordinary (non-null) comparison in the very same system must
// still emit `eq`/`ne` — a "fix" that routed every equality through `isNull`
// would pass the first half of this file and be catastrophically wrong.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/index.js";

const REPO = "ops_svc/db/repositories/workOrder-repository.ts";

function system(body: string): string {
  return `system Acme {
  subdomain Core {
    context Ops {
      aggregate Tech with crudish { name: string }
      repository Techs for Tech { }
      aggregate WorkOrder with crudish {
        title: string
        technicianId: Tech id?
      }
${body}
      repository WorkOrders for WorkOrder { }
    }
  }
  api OpsApi from Core
  storage primary { type: postgres }
  resource opsState { for: Ops, kind: state, use: primary }
  deployable opsSvc {
    platform: node  contexts: [Ops]  dataSources: [opsState]  serves: OpsApi  port: 3000
  }
}`;
}

async function repo(body: string): Promise<string> {
  const files = await generateSystemFiles(system(body));
  const src = files.get(REPO);
  expect(src, `${REPO} was not emitted — the fixture, not the assertion, is broken`).toBeDefined();
  return src!;
}

describe("drizzle lowers a null comparison to isNull / isNotNull (F-007)", () => {
  it("`!= null` becomes isNotNull and `== null` becomes isNull", async () => {
    const src = await repo(`      criterion Assigned() of WorkOrder = this.technicianId != null
      criterion Unassigned() of WorkOrder = this.technicianId == null
      retrieval AssignedOrders() of WorkOrder { where: Assigned() }
      retrieval UnassignedOrders() of WorkOrder { where: Unassigned() }`);

    expect(src).toContain(
      "const assignedCriterion = () => isNotNull(schema.workOrders.technicianId);",
    );
    expect(src).toContain(
      "const unassignedCriterion = () => isNull(schema.workOrders.technicianId);",
    );
    // The TS2769 shape itself: `null` must never reach an operator's value slot.
    expect(src).not.toMatch(/\b(?:eq|ne)\(schema\.\w+\.\w+, null\)/);
    // …and both operators have to be in the file's drizzle import line, or the
    // project trades TS2769 for TS2304.
    expect(src).toMatch(/^import \{[^}]*\bisNotNull\b[^}]*\} from "drizzle-orm";$/m);
    expect(src).toMatch(/^import \{[^}]*\bisNull\b[^}]*\} from "drizzle-orm";$/m);
  });

  it("sees the literal on the LEFT and through parentheses", async () => {
    const src = await repo(`      criterion Reversed() of WorkOrder = null != this.technicianId
      criterion Parenthesised() of WorkOrder = (this.technicianId) == (null)
      retrieval ReversedOrders() of WorkOrder { where: Reversed() }
      retrieval ParenOrders() of WorkOrder { where: Parenthesised() }`);

    expect(src).toContain(
      "const reversedCriterion = () => isNotNull(schema.workOrders.technicianId);",
    );
    expect(src).toContain(
      "const parenthesisedCriterion = () => isNull(schema.workOrders.technicianId);",
    );
    expect(src).not.toMatch(/\b(?:eq|ne)\(schema\.\w+\.\w+, null\)/);
  });

  it("NON-VACUITY: an ordinary comparison still lowers to eq / ne", async () => {
    const src = await repo(`      criterion Titled(t: string) of WorkOrder = this.title == t
      criterion NotTitled(t: string) of WorkOrder = this.title != t
      criterion Assigned() of WorkOrder = this.technicianId != null
      retrieval TitledOrders(t: string) of WorkOrder { where: Titled(t) }
      retrieval NotTitledOrders(t: string) of WorkOrder { where: NotTitled(t) }
      retrieval AssignedOrders() of WorkOrder { where: Assigned() }`);

    expect(src).toContain("eq(schema.workOrders.title, t)");
    expect(src).toContain("ne(schema.workOrders.title, t)");
    // …while the null one in the SAME file still took the IS NULL path, so the
    // two arms are proven to coexist rather than one having eaten the other.
    expect(src).toContain("isNotNull(schema.workOrders.technicianId)");
    expect(src).not.toContain("isNull(schema.workOrders.title)");
  });
});
