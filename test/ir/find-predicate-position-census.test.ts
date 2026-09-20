// Wave C2 packet 2n — the census that drains `loom.find-predicate-unsupported`.
//
// The register row's own drain condition (M-T6.35) was: "show the descriptors
// cannot fire, or delete them".  Measured on this tree, the MikroORM descriptor
// COULD still fire — on five shapes — and four of those five ALSO crashed
// drizzle codegen from source that validated `0 error(s)`:
//
//   find f1(): Order[] where this.flags.active     (a bool VO sub-property)
//   find f2(): Order[] where !this.flags.active
//   find f3(f: bool): Order[] where f              (a bool PARAMETER)
//   find f4(): Order[] where currentUser.isAdmin   (a bool CLAIM)
//   find f5(): Order[] where true                  (a literal)
//
// so the row was never an adapter narrowing.  It was `firstNonQueryableNode`
// being position-BLIND: it answers "could this node reach SQL at all", which is
// the right question for a comparison OPERAND and the wrong one for the
// predicate itself.  The split is now explicit — `firstNonQueryablePredicate`
// (`checks/shared.ts`) walks PREDICATE positions and requires every leaf to
// TEST a column, and the two column-rooted shapes that were genuinely missing
// from the two node adapters (a bare bool value-object sub-property, in the
// predicate and negated forms) were built on both.
//
// This census is what licences deleting the per-adapter descriptors: every
// shape below gets the SAME verdict on all four relational adapters, and every
// ADMITTED shape emits on all four without a `QueryEmissionRefusal`.  A
// re-introduced per-adapter narrowing fails part 1; a gate that admits a shape
// some adapter cannot lower fails part 2.

import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../_helpers/generate.js";
import { parseString } from "../_helpers/parse.js";

/** The four relational adapters a find predicate can be lowered by. */
const ADAPTERS = [
  ["drizzle", "node"],
  ["mikroorm", "node { persistence: mikroorm }"],
  ["efcore", "dotnet"],
  ["dapper", "dotnet { persistence: dapper }"],
] as const;

type Shape = {
  /** Census label — names the `ExprIR` kind / position under test. */
  readonly name: string;
  /** The `find` declaration, verbatim. */
  readonly find: string;
  /** true when every adapter must ACCEPT and emit it. */
  readonly admitted: boolean;
};

// One row per `ExprIR` kind that can stand in (or under) a predicate.  The
// kinds that cannot appear in a repository `where` at all — `lambda`, `new`,
// `object`, `list`, `action-ref`, `i18nFormat`, `match`, `ternary`, `convert`,
// `call`, `id`, `this` — are already refused by `firstNonQueryableNode` and are
// covered by `queryable-subset-parity.test.ts`; this census is about the
// PREDICATE POSITION, which is the axis the adapter descriptors lived on.
const SHAPES: readonly Shape[] = [
  // ---- admitted: a comparison with a column on one side -------------------
  { name: "compare: column vs literal", find: "find a1(): Order[] where this.qty > 3", admitted: true },
  {
    name: "compare: column vs param",
    find: "find a2(q: int): Order[] where this.qty == q",
    admitted: true,
  },
  {
    name: "compare: literal vs column (commuted)",
    find: "find a3(): Order[] where 3 < this.qty",
    admitted: true,
  },
  {
    name: "compare: column vs currentUser claim",
    find: "find a4(): Order[] where this.code == currentUser.name",
    admitted: true,
  },
  {
    name: "compare: VO sub-property column vs literal",
    find: 'find a5(): Order[] where this.flags.label == "x"',
    admitted: true,
  },
  // ---- admitted: a column-rooted bool standing alone ----------------------
  { name: "bare bool column", find: "find b1(): Order[] where this.live", admitted: true },
  { name: "negated bool column", find: "find b2(): Order[] where !this.live", admitted: true },
  {
    name: "bare bool VO sub-property",
    find: "find b3(): Order[] where this.flags.active",
    admitted: true,
  },
  {
    name: "negated bool VO sub-property",
    find: "find b4(): Order[] where !this.flags.active",
    admitted: true,
  },
  // ---- admitted: connectives over the above -------------------------------
  {
    name: "&& / || / ! / parens over predicates",
    find: "find c1(q: int): Order[] where (this.live && this.qty > q) || !this.flags.active",
    admitted: true,
  },
  // ---- admitted: a bool-returning queryable intrinsic ---------------------
  {
    name: "bool-returning queryable intrinsic on a column",
    find: 'find d1(): Order[] where this.code.startsWith("A")',
    admitted: true,
  },
  // ---- refused: a leaf that is not a column test --------------------------
  {
    name: "literal in predicate position",
    find: "find e1(): Order[] where true",
    admitted: false,
  },
  {
    name: "bool parameter in predicate position",
    find: "find e2(f: bool): Order[] where f",
    admitted: false,
  },
  {
    name: "currentUser claim in predicate position",
    find: "find e3(): Order[] where currentUser.isAdmin",
    admitted: false,
  },
  {
    name: "non-bool column in predicate position",
    find: "find e4(): Order[] where this.code",
    admitted: false,
  },
  {
    name: "comparison with no column on either side",
    find: "find e5(q: int): Order[] where q == 1",
    admitted: false,
  },
  {
    name: "arithmetic in predicate position",
    find: "find e6(): Order[] where this.qty + 1",
    admitted: false,
  },
];

const ADMITTED = SHAPES.filter((s) => s.admitted);

function source(platform: string, finds: string): string {
  return `
    system S {
      user { id: guid  name: string  isAdmin: bool }
      api OrdersApi from M
      subdomain M {
        context C {
          valueobject Flags { active: bool  label: string }
          aggregate Order with crudish {
            code:  string
            qty:   int
            live:  bool
            flags: Flags
          }
          repository Orders for Order {
${finds}
          }
        }
      }
      storage pg { type: postgres }
      resource cState { for: C, kind: state, use: pg }
      deployable api {
        platform: ${platform}
        contexts: [C]
        dataSources: [cState]
        serves: OrdersApi
        port: 8080
      }
    }
  `;
}

async function errorsFor(platform: string, finds: string): Promise<string[]> {
  const { model } = await parseString(source(platform, finds), { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.severity === "error")
    .map((d) => `${d.code}: ${d.message}`);
}

describe("find-predicate position census (wave C2 / M-T6.35)", () => {
  // Part 1 — every adapter gives every shape the SAME verdict.  This is the
  // assertion the per-adapter descriptors used to break: `where true` was
  // clean on drizzle / EF Core / Dapper and `loom.find-predicate-unsupported`
  // on MikroORM.
  for (const shape of SHAPES) {
    it(`all four adapters agree on: ${shape.name}`, async () => {
      const perAdapter = new Map<string, string[]>();
      for (const [adapter, platform] of ADAPTERS) {
        perAdapter.set(adapter, await errorsFor(platform, `            ${shape.find}`));
      }
      for (const [adapter, errs] of perAdapter) {
        if (shape.admitted) {
          expect(errs, `${adapter} must ADMIT '${shape.name}'`).toEqual([]);
        } else {
          expect(
            errs.join("\n"),
            `${adapter} must REFUSE '${shape.name}' through the target-neutral gate`,
          ).toContain("loom.find-where-not-queryable");
        }
      }
      // No adapter may refuse through a per-adapter narrowing: that code is
      // what this census exists to prove unreachable.
      for (const [adapter, errs] of perAdapter) {
        expect(
          errs.join("\n"),
          `${adapter} refused '${shape.name}' with a per-adapter code, not the neutral gate`,
        ).not.toContain("loom.find-predicate-unsupported");
      }
    });
  }

  // Part 2 — every ADMITTED shape EMITS a REAL query on every adapter.
  //
  // The two failure modes are different per adapter and only one of them is
  // loud, which is the whole reason this part asserts the BODY and not just
  // that a method with the right name exists:
  //
  //   drizzle  — `refuseOutOfVocabulary` THROWS at generate time
  //              (`QueryEmissionRefusal`), so the generation itself fails;
  //   mikroorm — emits `throw new Error("mikroorm v1: this find's predicate is
  //              not yet supported")` as the method BODY;
  //   dapper   — emits `throw new NotImplementedException("Dapper v1 does not
  //              support this find's predicate.")` likewise.
  //
  // The first draft of this census checked only that each find's NAME appeared
  // somewhere in the tree, and it passed with the MikroORM fix reverted — the
  // stub carries the name.  A stub sentinel is therefore as much a failure as a
  // throw.
  const STUB_SENTINELS = [
    "this find's predicate is not yet supported",
    "does not support this find's predicate",
    "this retrieval's predicate is not yet supported",
  ];
  for (const [adapter, platform] of ADAPTERS) {
    it(`${adapter} emits a real query for every admitted predicate`, async () => {
      const finds = ADMITTED.map((s) => `            ${s.find}`).join("\n");
      const files = await generateSystemFiles(source(platform, finds));
      const all = [...files.values()].join("\n");
      for (const s of ADMITTED) {
        const name = /find (\w+)\(/.exec(s.find)?.[1];
        expect(name, `census row '${s.name}' has no find name`).toBeTruthy();
        expect(
          all.toLowerCase(),
          `${adapter} emitted no method for '${s.name}' (${name})`,
        ).toContain(String(name).toLowerCase());
      }
      for (const sentinel of STUB_SENTINELS) {
        expect(
          all,
          `${adapter} emitted an unsupported-predicate STUB for one of the ` +
            `${ADMITTED.length} admitted shapes — a method that compiles and throws ` +
            `at runtime is not an emission`,
        ).not.toContain(sentinel);
      }
    });
  }
});
