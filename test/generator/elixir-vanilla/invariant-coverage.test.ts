import { describe, expect, it } from "vitest";
import { enrichLoomModel } from "../../../src/ir/enrich/enrichments.js";
import { lowerModel } from "../../../src/ir/lower/lower.js";
import { validateLoomModel } from "../../../src/ir/validate/validate.js";
import { generateSystemFiles } from "../../_helpers/generate.js";
import { parseString } from "../../_helpers/index.js";

// ---------------------------------------------------------------------------
// Invariant COVERAGE on the vanilla (Ecto/Phoenix) foundation — #3023.
//
// The changeset has two carriers: a native `validate_*` line (single-field
// rules) and the custom `validate_invariants/1` seam.  A rule matching NEITHER
// used to fall through both IN SILENCE, so it was enforced at the domain floor
// on node/.NET/python/java and nowhere on elixir, while `generate system`
// reported `0 error(s), 0 warning(s)`.
//
// Measured before the fix, on one aggregate carrying five invariants:
//
//   invariant sku.length > 0          native      -> elixir OK
//   invariant qty >= 1                native      -> elixir OK
//   invariant sku.trim().length > 0   method-call -> elixir DROPPED
//   invariant lines.count > 0         collection  -> elixir DROPPED
//   invariant isBig == false          derived     -> elixir DROPPED
//
// node/dotnet/java/python: 5/5.  elixir: 2/5.
//
// This suite pins the post-fix contract, which has TWO halves and needs both —
// widening alone would leave a smaller silent hole, and the gate alone would
// leave the rules unenforced:
//
//   1. every shape the applied struct CAN evaluate is now enforced;
//   2. every shape it cannot is REPORTED (`loom.elixir-invariant-unenforced`),
//      so the set of silently-missing rules is empty BY CONSTRUCTION — a shape
//      nobody enumerated lands in the gate, not on the floor.
//
// The two nastiest regressions this guards are NOT "is it emitted" but "is what
// is emitted correct":
//   • a derived read must INLINE (`data.qty > 100`), because `data.is_big` is
//     not a struct key and would be a runtime KeyError;
//   • a REFERENCE collection (`X id[]`) must NOT be enforced here at all — its
//     join rows are written after the changeset, so the rule would read `[]` and
//     pass for every input.  Enforcement in name only is worse than the drop,
//     because it also looks enforced.
// ---------------------------------------------------------------------------

function sys(body: string, extra = ""): string {
  return `
system S {
  user { id: string  role: string  permissions: string[] }
  subdomain Shop {
    context Shop {
      ${body}
      repository Orders for Order { }
      ${extra}
    }
  }
  storage pg { type: postgres }
  resource st { for: Shop, kind: state, use: pg }
  deployable api { platform: elixir contexts: [Shop] dataSources: [st] port: 4000 }
}
`;
}

async function changesetOf(src: string): Promise<string> {
  const files = await generateSystemFiles(src);
  const key = [...files.keys()].find((k) => k.endsWith("/shop/order_changeset.ex"))!;
  return files.get(key)!;
}

/** The gate is a PHASE-⑦ check, so it is read off `validateLoomModel` — a
 *  phase-④ `parseString({validate:true})` never sees it. */
const warnings = async (src: string): Promise<string[]> => {
  const { model } = await parseString(src, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)))
    .filter((d) => d.code === "loom.elixir-invariant-unenforced")
    .map((d) => d.message);
};

/** Phase-⑦ diagnostics of any severity, for the "this is a warning" assertion. */
const irDiags = async (src: string) => {
  const { model } = await parseString(src, { validate: false });
  return validateLoomModel(enrichLoomModel(lowerModel(model)));
};

describe("vanilla — invariant coverage (#3023)", () => {
  // --- the five-shape regression, end to end -------------------------------

  it("enforces ALL FIVE shapes that used to be 2 of 5", async () => {
    const cs = await changesetOf(
      sys(`aggregate Order {
        sku: string
        qty: int
        contains lines: Line[]
        derived isBig: bool = qty > 100
        invariant sku.length > 0
        invariant qty >= 1
        invariant sku.trim().length > 0
        invariant lines.count > 0
        invariant isBig == false
        entity Line { amount: int }
      }`),
    );
    // 1+2 — the native lines that always worked.
    expect(cs).toMatch(/validate_change\(:sku/);
    expect(cs).toMatch(/validate_number\(:qty, greater_than_or_equal_to: 1/);
    // 3 — a method call: the intrinsic chain renders through `renderExpr`.
    expect(cs).toMatch(/String\.trim\(data\.sku\)/);
    // 4 — a contained collection.
    expect(cs).toMatch(/Enum\.count\(data\.lines\)/);
    // 5 — a derived read, INLINED (see below for why this matters).
    expect(cs).toMatch(/\(data\.qty > 100\) == false/);
  });

  // --- the two correctness traps -------------------------------------------

  it("INLINES a derived read — `data.is_big` would be a runtime KeyError", async () => {
    // Elixir structs carry no computed field. `renderExpr` inlines a
    // `this-derived` read, but only when `ctx.agg` carries the derived index —
    // and the invariant carrier did not pass one, so admitting the shape
    // without threading it would have emitted a missing struct key and turned a
    // 422 into a 500. This asserts the inline and the ABSENCE of the accessor.
    const cs = await changesetOf(
      sys(`aggregate Order {
        qty: int
        derived isBig: bool = qty > 100
        invariant isBig == false
      }`),
    );
    expect(cs).toMatch(/\(data\.qty > 100\) == false/);
    expect(cs).not.toMatch(/data\.is_big/);
  });

  it("does NOT enforce a reference collection, and warns instead", async () => {
    // `members: Member id[]` is a `many_to_many` whose join rows the repository
    // writes AFTER the changeset; the changeset carries only a
    // `foreign_key_constraint`. So `data.members` is `%NotLoaded{}` → `[]` on
    // every write path, and `Enum.count(...) <= 6` would be TRUE for a
    // seven-member squad. Refused here (and reported by the gate) rather than
    // emitted as a rule that cannot fail.
    const src = sys(
      `aggregate Order {
        label: string
        members: Member id[]
        invariant members.count <= 6
      }`,
      `aggregate Member { nick: string }
       repository Members for Member { }`,
    );
    const cs = await changesetOf(src);
    expect(cs).not.toMatch(/Enum\.count\(data\.members\)/);
    const w = await warnings(src);
    expect(w, w.join("\n")).toHaveLength(1);
    expect(w[0]).toMatch(/reference collection/);
    expect(w[0]).toMatch(/pass for every input/);
  });

  it("normalises an unloaded containment to `[]` rather than raising", async () => {
    // `Enum.count/1` on `%Ecto.Association.NotLoaded{}` raises
    // `Protocol.UndefinedError` — a 500 where the silent drop at least answered
    // 201. An unloaded containment means "no children" (create omitted the key;
    // update preloads), which is the empty list the other backends hold.
    const cs = await changesetOf(
      sys(`aggregate Order {
        sku: string
        contains lines: Line[]
        invariant lines.count > 0
        entity Line { amount: int }
      }`),
    );
    expect(cs).toMatch(/data = %\{data \| lines: __loom_list\(data\.lines\)\}/);
    expect(cs).toMatch(/defp __loom_list\(%Ecto\.Association\.NotLoaded\{\}\), do: \[\]/);
  });

  it("guards a widened check on `changeset.valid?` so a missing field is 422, not 500", async () => {
    // `apply_changes/1` yields nil for a required field the request omitted, and
    // `String.trim(nil)` raises — which would answer 500 where
    // `validate_required` has already queued the 422.
    const cs = await changesetOf(
      sys(`aggregate Order {
        sku: string
        invariant sku.trim().length > 0
      }`),
    );
    expect(cs).toMatch(/if changeset\.valid\? do/);
  });

  // --- the gate: nothing is dropped in silence -----------------------------

  it("warns on a domainService call, naming the call as the reason", async () => {
    // A `currentUser` read is deliberately NOT tested here: it is already a hard
    // error anywhere in an invariant (`loom.currentuser-not-in-request-scope`),
    // so it can never reach this gate — which is why `unenforceableReason` has
    // no arm for it. A domainService call is the reachable "cannot invoke" case.
    const src = sys(
      `aggregate Order {
        sku: string
        qty: int
        invariant Calc.twice(qty) > 2
      }`,
      `domainService Calc { operation twice(n: int): int { return n * 2 } }`,
    );
    const w = await warnings(src);
    expect(w, w.join("\n")).toHaveLength(1);
    expect(w[0]).toMatch(/calls a domainService or a resource/);
  });

  it("names the invariant SOURCE and the aggregate, so the author can find it", async () => {
    const w = await warnings(
      sys(
        `aggregate Order {
          label: string
          members: Member id[]
          invariant members.count <= 6
        }`,
        `aggregate Member { nick: string }
         repository Members for Member { }`,
      ),
    );
    expect(w[0]).toMatch(/invariant 'members\.count <= 6' on 'Shop\.Order'/);
  });

  it("is a WARNING, not an error — the model is legal and other backends run it", async () => {
    const d = await irDiags(
      sys(
        `aggregate Order {
          label: string
          members: Member id[]
          invariant members.count <= 6
        }`,
        `aggregate Member { nick: string }
         repository Members for Member { }`,
      ),
    );
    const mine = d.filter((x) => x.code === "loom.elixir-invariant-unenforced");
    expect(mine).toHaveLength(1);
    expect(mine[0]!.severity).toBe("warning");
    expect(d.filter((x) => x.severity === "error")).toHaveLength(0);
  });

  // --- no false positives --------------------------------------------------

  it("does NOT warn when every invariant is enforced", async () => {
    const w = await warnings(
      sys(`aggregate Order {
        sku: string
        qty: int
        contains lines: Line[]
        derived isBig: bool = qty > 100
        invariant sku.length > 0
        invariant qty >= 1
        invariant sku.trim().length > 0
        invariant lines.count > 0
        invariant isBig == false
        entity Line { amount: int }
      }`),
    );
    expect(w, w.join("\n")).toHaveLength(0);
  });

  it("does not fire for a context hosted on a non-elixir backend", async () => {
    const w = await warnings(`
system S {
  user { id: string  role: string  permissions: string[] }
  subdomain Shop {
    context Shop {
      aggregate Order { sku: string  owner: string  invariant owner == currentUser.id }
      repository Orders for Order { }
    }
  }
  storage pg { type: postgres }
  resource st { for: Shop, kind: state, use: pg }
  deployable api { platform: node contexts: [Shop] dataSources: [st] port: 4000 }
}
`);
    expect(w, w.join("\n")).toHaveLength(0);
  });

  it("leaves an aggregate with only native single-field rules byte-unchanged", async () => {
    // The widening must not pull a rule that already had a native line into the
    // residual carrier — that would move emitted bytes for most of the corpus.
    const cs = await changesetOf(
      sys(`aggregate Order {
        sku: string
        qty: int
        invariant sku.length > 0
        invariant qty >= 1
      }`),
    );
    expect(cs).not.toMatch(/validate_invariants/);
  });
});
