import { describe, expect, it } from "vitest";
import type { ExprIR } from "../../../src/ir/types/loom-ir.js";
import {
  type FindPredicateAdapter,
  firstUnlowerableForAdapter,
  isFindPredicateAdapter,
} from "../../../src/ir/util/find-predicate-capability.js";
// The target-NEUTRAL gate this table's last narrowing moved into.  Imported
// here on purpose: "the adapter no longer narrows it" is only half a claim, and
// the other half lives one module over.
import { firstNonQueryableNode } from "../../../src/ir/validate/checks/shared.js";

// The per-persistence-adapter narrowing of the queryable predicate subset.
// M-T9.17 slice 3 — no test imports this module directly.
//
// This descriptor is a GATE: `ir/validate` asks it whether the selected adapter
// can lower a `find` / `filter` / retrieval predicate, and refuses at generate
// time when it cannot.  Both directions of a wrong answer are silent and
// expensive:
//
//   • a FALSE NEGATIVE (says "lowerable" when the adapter cannot) ships the
//     failure downstream — MikroORM throws "not yet supported" mid-generate,
//     Dapper used to emit a `NotImplementedException` stub that compiles and
//     then 500s at runtime;
//   • a FALSE POSITIVE (says "unlowerable" for a shape the adapter handles)
//     refuses a perfectly good model, and the refusal names a node the author
//     is told to remove.
//
// The tests pin the SHAPE OF THE NARROWING, not the message wording: which
// adapters are at the EF Core baseline, and what MikroORM — the one adapter
// with a table of its own — still refuses.  FOUR of the narrowings this table
// used to carry are gone
// (`currentUser.<field>`, whose real defect was a missing method parameter one
// layer out; Dapper's whole subset, now the full baseline; and — C2/2c —
// `this.<refColl>.contains(x)` membership, whose recorded reason, "needs a
// correlated join the adapter emits nowhere", was a claim about the EXISTS
// SPELLING rather than about the adapter: an uncorrelated `id in (select …)`
// says the same thing, needs no outer alias, and is what the drizzle twin has
// always emitted).  All three are asserted here as explicitly LOWERABLE, so
// re-adding a narrowing that was diagnosed as belonging elsewhere fails rather
// than quietly returning.
//
// The FOURTH is the one that survived the C2/2c pass and has now moved rather
// than been deleted: a membership whose ARGUMENT is a column rather than a
// bindable value.  The join subquery binds its target as a parameter on EVERY
// adapter, so the refusal is target-neutral and belongs in
// `firstNonQueryableNode` — where a deployable on the DEFAULT adapter (which
// carries no `persistence:` selector, and so never reached this table at all)
// also meets it, instead of crashing drizzle codegen.  The ex-membership pins
// below therefore assert BOTH halves: null here, named there.  Asserting only
// the first half would read the same whether the rule moved or was dropped.

const thisRecv = { kind: "this" } as unknown as ExprIR;

/** The row the `this.<field>` members hang off.  The adapter table never reads
 *  a member's RECEIVER type — but `firstNonQueryableNode`, which these fixtures
 *  are now also fed through, rejects a member whose receiver is a collection,
 *  so the fixtures carry the field a real lowering always stamps. */
const rowType = { kind: "entity", name: "Row" };

const boolMember = (member: string): ExprIR =>
  ({
    kind: "member",
    receiver: thisRecv,
    receiverType: rowType,
    member,
    memberType: { kind: "primitive", name: "bool" },
  }) as unknown as ExprIR;

const strMember = (member: string): ExprIR =>
  ({
    kind: "member",
    receiver: thisRecv,
    receiverType: rowType,
    member,
    memberType: { kind: "primitive", name: "string" },
  }) as unknown as ExprIR;

/** A bound string literal.  `kind: "literal"` is the real spelling (the
 *  adapter table never looks, but `firstNonQueryableNode` does — and a fixture
 *  that is not a literal there would be rejected for the wrong reason). */
const strLit = (value: string): ExprIR =>
  ({ kind: "literal", lit: "string", value }) as unknown as ExprIR;

const binary = (op: string, left: ExprIR, right: ExprIR): ExprIR =>
  ({ kind: "binary", op, left, right }) as unknown as ExprIR;

const not = (operand: ExprIR): ExprIR => ({ kind: "unary", op: "!", operand }) as unknown as ExprIR;

const paren = (inner: ExprIR): ExprIR => ({ kind: "paren", inner }) as unknown as ExprIR;

/** `this.<refColl>.contains(x)` — membership over a reference collection.  The
 *  receiver type is what identifies it: an array OF IDS. */
const containsMembership = (): ExprIR =>
  ({
    kind: "method-call",
    member: "contains",
    receiver: strMember("tags"),
    receiverType: { kind: "array", element: { kind: "id", name: "Tag" } },
    args: [strLit("t1")],
  }) as unknown as ExprIR;

/** `this.<refColl>.contains(this.<field>)` — membership whose ARGUMENT is a
 *  COLUMN of the same row rather than a bindable value.  The join-table
 *  subquery binds its target as a parameter on every adapter, so a column
 *  there has nowhere to go — which is why it is no longer an ADAPTER narrowing
 *  at all, but a target-neutral refusal in `firstNonQueryableNode`. */
const columnArgMembership = (): ExprIR =>
  ({
    kind: "method-call",
    member: "contains",
    receiver: strMember("tags"),
    receiverType: { kind: "array", element: { kind: "id", name: "Tag" } },
    args: [strMember("id")],
  }) as unknown as ExprIR;

/** A `queryable` catalogue intrinsic over a primitive receiver. */
const queryableIntrinsic = (member: string): ExprIR =>
  ({
    kind: "method-call",
    member,
    receiver: strMember("name"),
    receiverType: { kind: "primitive", name: "string" },
    args: [],
  }) as unknown as ExprIR;

const authzFilter = (): ExprIR => ({ kind: "authz-filter", stance: "deny" }) as unknown as ExprIR;

const BASELINE: FindPredicateAdapter[] = ["efcore", "drizzle", "dapper"];
const ALL: FindPredicateAdapter[] = ["efcore", "drizzle", "dapper", "mikroorm"];

describe("isFindPredicateAdapter", () => {
  it("recognises exactly the four relational adapters", () => {
    for (const name of ALL) expect(isFindPredicateAdapter(name)).toBe(true);
  });

  it("rejects a non-relational or unknown persistence selector", () => {
    // Only relational adapters lower a predicate to SQL; a name that reaches
    // the gate without being one must not silently index into the capability
    // table (`CAPABILITIES[name]` would be `undefined` and throw at call time).
    for (const name of ["memory", "ecto", "sqlalchemy", "jpa", "", "Drizzle"]) {
      expect(isFindPredicateAdapter(name), name).toBe(false);
    }
  });
});

describe("the EF Core baseline — efcore, drizzle and dapper narrow NOTHING", () => {
  // Asserted per adapter rather than over a merged fixture: each is a separate
  // entry in the capability table, and one of them silently falling back to a
  // narrowing (or to `undefined`) is exactly the drift this table exists to
  // prevent.
  const everyQueryableShape: [string, ExprIR][] = [
    ["a comparison", binary("==", strMember("status"), strLit("open"))],
    [
      "an && of comparisons",
      binary("&&", binary("==", strMember("a"), strLit("x")), boolMember("active")),
    ],
    ["a bare boolean column", boolMember("active")],
    ["a negated boolean column", not(boolMember("deleted"))],
    ["refColl membership", containsMembership()],
    ["a queryable intrinsic", queryableIntrinsic("trim")],
    ["an authz/tenancy sentinel", authzFilter()],
  ];

  for (const adapter of BASELINE) {
    for (const [label, expr] of everyQueryableShape) {
      it(`${adapter} lowers ${label}`, () => {
        expect(firstUnlowerableForAdapter(expr, adapter)).toBeNull();
      });
    }
  }
});

describe("MikroORM — the last narrowing MOVED to the target-neutral gate", () => {
  // The column-argument membership (`where o.tags.contains(o.id)`) used to be
  // MikroORM's one remaining narrowing.  It was never this adapter's: the
  // join-table subquery binds its target as a PARAMETER on every adapter, so a
  // column there has nowhere to go on all four.  Keeping it here made the
  // refusal depend on the `persistence:` selector — which a deployable on the
  // DEFAULT adapter does not carry — so the identical shape CRASHED codegen on
  // drizzle while MikroORM refused it honestly.
  //
  // So these pins assert the move in BOTH halves: gone from the adapter table,
  // and PRESENT in `firstNonQueryableNode`.  Asserting only the first half
  // would read the same whether the rule moved or was simply deleted.

  it("no longer narrows a COLUMN membership argument — the refusal moved, it did not vanish", () => {
    expect(firstUnlowerableForAdapter(columnArgMembership(), "mikroorm")).toBeNull();
    // …and the neutral gate every site and every backend consults still names
    // it.  This is the half that makes the `toBeNull()` above a MOVE rather
    // than a hole.
    expect(firstNonQueryableNode(columnArgMembership())).toContain("<column>");
    // The plain membership stays admitted at both, or the line above would be
    // refusing the whole shape rather than its argument.
    expect(firstNonQueryableNode(containsMembership())).toBeNull();
  });

  it("LOWERS `this.<refColl>.contains(x)` membership", () => {
    // Was "REJECTS …", on the reason "the correlated EXISTS subquery the
    // adapter emits nowhere".  The EXISTS form indeed could not have worked —
    // MikroORM names the root table `e0` in the SQL it builds, so a fragment
    // correlating on `<table>.id` fails with "missing FROM-clause entry" — but
    // the membership never needed to be correlated: `id in (select __j.<ownerFk>
    // from <join> __j where __j.<targetFk> = ?)` says the same thing with no
    // outer alias, and is what `containsMembershipFragment` now emits.
    expect(firstUnlowerableForAdapter(containsMembership(), "mikroorm")).toBeNull();
  });

  it("admits membership in a comparison OPERAND the same way it does at the root", () => {
    // A comparison's operands are values, and a value position must not judge
    // membership differently from a predicate position — on either side of the
    // move.  The neutral gate is asserted in the same two positions, since it
    // is now the only thing that can refuse the column-argument twin.
    expect(
      firstUnlowerableForAdapter(binary("==", containsMembership(), strLit("x")), "mikroorm"),
    ).toBeNull();
    expect(
      firstUnlowerableForAdapter(binary("==", columnArgMembership(), strLit("x")), "mikroorm"),
    ).toBeNull();
    expect(firstNonQueryableNode(binary("==", columnArgMembership(), strLit("x")))).toContain(
      "<column>",
    );
  });

  it("reaches membership nested under an && / ! / parens, at both gates", () => {
    const bury = (m: ExprIR): ExprIR => not(paren(binary("&&", boolMember("active"), m)));
    expect(firstUnlowerableForAdapter(bury(containsMembership()), "mikroorm")).toBeNull();
    expect(firstUnlowerableForAdapter(bury(columnArgMembership()), "mikroorm")).toBeNull();
    // The neutral gate's structural walk must still DESCEND to it — a walk that
    // stopped at the `!` would return null here for the wrong reason and read
    // as a pass.
    expect(firstNonQueryableNode(bury(columnArgMembership()))).toContain("<column>");
  });

  it("still lowers a bare boolean column", () => {
    expect(firstUnlowerableForAdapter(boolMember("active"), "mikroorm")).toBeNull();
  });

  it("still lowers a comparison, an && and a || of predicates", () => {
    const cmp = binary("==", strMember("status"), strLit("open"));
    expect(firstUnlowerableForAdapter(cmp, "mikroorm")).toBeNull();
    expect(firstUnlowerableForAdapter(binary("&&", cmp, boolMember("a")), "mikroorm")).toBeNull();
    expect(firstUnlowerableForAdapter(binary("||", cmp, boolMember("a")), "mikroorm")).toBeNull();
  });

  it("still lowers a queryable scalar intrinsic standing alone (the raw() fragment)", () => {
    expect(firstUnlowerableForAdapter(queryableIntrinsic("trim"), "mikroorm")).toBeNull();
  });

  it("still lowers the authz/tenancy sentinel", () => {
    // `deny` is the always-false FilterQuery contradiction; the deep/global
    // scope sentinel is a `raw()` prefix test.  Both lower, so the sentinel
    // must never be reported as a narrowing — a false positive here would
    // refuse every tenant-scoped find on the adapter.
    expect(firstUnlowerableForAdapter(authzFilter(), "mikroorm")).toBeNull();
  });

  it("REJECTS an arithmetic operator in a predicate position, naming the operator", () => {
    // `whereToMikroFilter` accepts only top-level comparisons / && / ||; a
    // FilterQuery has no arithmetic position at all.
    const reason = firstUnlowerableForAdapter(binary("+", strMember("a"), strLit("b")), "mikroorm");
    expect(reason).toContain("arithmetic '+'");
  });

  it("reports the FIRST unlowerable node, walking the left branch before the right", () => {
    // The contract is "first node this adapter cannot lower" — the message
    // points the author at one site, so which one it picks is part of the
    // behaviour, not an accident of traversal.
    // The right branch must ALSO be unlowerable, or "left before right" is not
    // what the assertion measures.  With the column-argument narrowing moved to
    // the neutral gate, the only shapes left here are the arithmetic ones, so
    // the two branches are told apart by their OPERATOR.
    const reason = firstUnlowerableForAdapter(
      binary(
        "&&",
        binary("+", strMember("a"), strLit("b")),
        binary("-", strMember("c"), strLit("d")),
      ),
      "mikroorm",
    );
    expect(reason).toContain("arithmetic '+'");
    expect(reason, "the RIGHT branch was reported, so the walk is not left-first").not.toContain(
      "arithmetic '-'",
    );
    // …and the right branch really is a finding on its own, not a null that
    // would make the lines above pass for free.
    expect(
      firstUnlowerableForAdapter(binary("-", strMember("c"), strLit("d")), "mikroorm"),
    ).toContain("arithmetic '-'");
  });

  it("peels parens before judging — `(this.active)` is still a bare boolean column", () => {
    expect(firstUnlowerableForAdapter(paren(boolMember("active")), "mikroorm")).toBeNull();
  });
});

describe("a non-boolean bare member is not a boolean column", () => {
  it("MikroORM rejects a bare STRING column in a predicate position", () => {
    // `isBareBooleanColumn` checks the member TYPE, not merely that the node is
    // a `this.<field>` member: `{ name: true }` is not what a string column in
    // a boolean position means, and emitting it would silently filter on the
    // wrong value.
    expect(firstUnlowerableForAdapter(strMember("name"), "mikroorm")).toContain("member");
  });

  it("but the baseline adapters lower it (they are unconditional)", () => {
    for (const adapter of BASELINE) {
      expect(firstUnlowerableForAdapter(strMember("name"), adapter), adapter).toBeNull();
    }
  });
});
