// M-T6.51 — `ignoring <Cap>` / `ignoring *` on the NON-RELATIONAL node saving
// shapes.  `test/generator/typescript/filter-bypass.test.ts` covers the plain
// relational repository; every other shape computed ONE capability predicate
// per aggregate and reused it for every read, so a widened
// `Repo.find(C) ignoring softDeletable` read still filtered the soft-deleted
// rows out.
// Wrong data, fail-closed, and no diagnostic — the worst of the three failure
// modes, because nothing about the generated project looks wrong.
//
// Three shapes were affected and all three are pinned here:
//   • `shape: document` on drizzle   (repository-document-builder.ts)
//   • `shape: document` on mikroorm  (emit/mikroorm.ts — the same reuse)
//   • `shape: embedded`              (repository-embedded-builder.ts — its
//                                     conjunct is real SQL, not in-app)
//
// Plus the synthesised query-time-projection read, which carries the
// PROJECTION's own `ignoring` on its `FindIR` (`projection-finds.ts`) and so
// inherited the same bug.
//
// The elixir twin of the document half is §A11, fixed in #2667.

import { describe, expect, it } from "vitest";
import { generateSystemFiles } from "../../_helpers/generate.js";

/** Three reads over one soft-deletable aggregate: one bypassing by name, one
 *  bypassing everything, one plain control. */
function src(shape: string, persistence = ""): string {
  return `
  system S {
    capability softDeletable { isDeleted: bool  filter this.isDeleted == false }
    subdomain D { context C {
      aggregate Order ${shape} with softDeletable { total: int  status: string }
      repository OrderRepo for Order
      criterion OrdersRecent of Order = this.total > 0
      criterion OrdersNormal of Order = this.total > 0
      queryHandler GetRecent(): Order {
        if let x = OrderRepo.find(OrdersRecent()) ignoring softDeletable { return x } else { notFound "not_found" }
      }
      queryHandler GetNormal(): Order {
        if let x = OrderRepo.find(OrdersNormal()) { return x } else { notFound "not_found" }
      }
      domainService Probe {
        operation exists(id: Order id): bool {
          return OrderRepo.find(id) ignoring * != null
        }
      }
      projection AllOrders {
        status: string
        from Order as o ignoring softDeletable
        select status = o.status
      }
      projection LiveOrders {
        status: string
        from Order as o
        select status = o.status
      }
    }}
    storage primary { type: postgres }
    resource cState { for: C, kind: state, use: primary }
    deployable api { platform: node ${persistence} contexts: [C]  dataSources: [cState]  port: 3000 }
  }`;
}

async function repoFile(shape: string, persistence = ""): Promise<string> {
  const files = await generateSystemFiles(src(shape, persistence));
  const k = [...files.keys()].find((key) => key.endsWith("db/repositories/order-repository.ts"));
  expect(k, "order-repository.ts not emitted").toBeDefined();
  return files.get(k!)!;
}

function methodBody(file: string, name: string): string {
  const start = file.indexOf(`async ${name}(`);
  expect(start, `method ${name} not found`).toBeGreaterThanOrEqual(0);
  const next = file.indexOf("\n  async ", start + 1);
  return file.slice(start, next === -1 ? undefined : next);
}

/** The soft-delete conjunct in whichever form the shape emits it: an in-app
 *  predicate over the rehydrated row (document) or, for a SQL read (embedded), a
 *  call of the aggregate's scope helper that leaves it (`orderScope()` — an
 *  `ignoring` read passes its clause, or drops the call altogether). */
function mentionsSoftDeleteFilter(body: string): boolean {
  return /x\.isDeleted === false|schema\.orders\.isDeleted|\borderScope\(\)/.test(body);
}

describe.each([
  ["shape: document,", "", "document / drizzle"],
  ["shape: document,", "{ persistence: mikroorm }", "document / mikroorm"],
  ["shape: embedded,", "", "embedded / drizzle"],
])("%s %s — `ignoring` on a non-relational shape (%s)", (shape, persistence) => {
  it("`ignoring <Cap>` drops the bypassed conjunct from THAT read only", async () => {
    const file = await repoFile(shape, persistence);
    const recent = methodBody(file, "findFirstOrdersRecentIgnoringSoftDeletable");
    expect(mentionsSoftDeleteFilter(recent)).toBe(false);
    // The read's OWN predicate survives — only the capability conjunct went.
    expect(recent).toMatch(/total|ordersRecentCriterion/);
    // …and the clause-less root read is untouched, which is what makes this a
    // bypass rather than a capability that stopped working.
    expect(mentionsSoftDeleteFilter(methodBody(file, "all"))).toBe(true);
  });

  // A plain `Repo.find(C)` read calls `repo.runFindAllBy<C>(…)` whatever the
  // saving shape, and that runner keeps the capability conjunct the
  // `ignoring` reads above drop.
  it("the plain criterion read is emitted and keeps the conjunct", async () => {
    const file = await repoFile(shape, persistence);
    expect(mentionsSoftDeleteFilter(methodBody(file, "runFindAllByOrdersNormal"))).toBe(true);
  });

  it("`ignoring *` drops every capability conjunct", async () => {
    const file = await repoFile(shape, persistence);
    const anyRow = methodBody(file, "findByIdIgnoringAll");
    expect(mentionsSoftDeleteFilter(anyRow)).toBe(false);
    // The read's own key survives.
    expect(anyRow).toMatch(/\bid\b/);
  });

  it("a query-time projection's read is synthesised at all, and honours its own `ignoring`", async () => {
    const file = await repoFile(shape, persistence);
    // The route calls `repo.<projName>()` by name whatever the saving shape.
    // On `shape: embedded` the method was simply ABSENT — TS2339, a generated
    // project that does not compile — so this assertion is the compile-tier
    // half and the two below are the correctness half.
    expect(file, "synthesised projection read not emitted").toContain("async allOrders(");
    expect(mentionsSoftDeleteFilter(methodBody(file, "allOrders"))).toBe(false);
    expect(mentionsSoftDeleteFilter(methodBody(file, "liveOrders"))).toBe(true);
  });
});
