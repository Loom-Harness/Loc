// M-T5.44 slice 4 — the ratchet against a second type-inference path.
//
// Every expression is typed ONCE, by the single typing pass in
// `src/language/typing/`.  The validators read its results (through `typeOf`
// / `suffixType` / `envForNode`, which delegate), and lowering COPIES them
// into `TypeIR` (through `passType` / `inferExprType`).  Before M-T5.44 there
// were two whole checkers — `type-system.ts`'s `typeOf`/`typeAfterSuffix` and
// `lower-expr.ts`'s `inferExprType`/`memberType` — that disagreed on 60 % of
// the fleet's expressions; the census below keeps a third one from growing
// back, one helper at a time.
//
// THE RULE: outside `src/language/typing/`, no function may map an AST node
// to a type.  The scan finds every function in the language layer and in the
// IR lowerers whose parameters name an AST node type and whose result is a
// type (`TypeIR` / `DddType` / `Ty`).  The only ones allowed are the
// delegators listed in ALLOWED, each with what makes it a read rather than an
// inference.  A new one fails here; a listed one that disappears fails too
// (the list ratchets — delete the entry in the same change).

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SCANNED = ["src/language", "src/ir/lower"];
/** The pass itself, and the committed parser output. */
const EXEMPT_DIRS = ["src/language/typing", "src/language/generated"];

/** AST node types whose appearance in a parameter list makes a type-returning
 *  function an inference over the AST. */
const AST_PARAM =
  /\b(Expression|PostfixSuffix|MemberSuffix|CallSuffix|PostfixChain|AstNode|Lambda|BuilderCall|NameRef|LValue|MatchExpr|ListLit|BinaryChain|TernaryExpr)\b/;
const FN = /^(?:export )?function (\w+)\(([^)]*)\)\s*:\s*(?:TypeIR|DddType|Ty)(?:\[\])?\b/gm;

/** file:function → why it is a READ of the pass, not a second inference. */
const ALLOWED: Record<string, string> = {
  "src/language/type-system.ts:typeOf":
    "delegates to typeOfExpr, then applies null-guard narrowing to the pass's answer",
  "src/language/type-system.ts:typeOfExpr": "`typingFor(expr).synthAt(expr)` through `toDddType`",
  "src/language/type-system.ts:suffixType":
    "`typingFor(suffix).synthAt(suffix)` through `toDddType`",
  "src/language/lsp/member-refs.ts:receiverTypeForSuffix":
    "the head's `typeOf` or the previous suffix's `suffixType` — both the pass's",
  "src/language/validators/statements.ts:lvalueType":
    "`typingFor(lv).lvalueStepsAt(lv)`; reports the unresolved segment the pass left `unknown`",
  "src/ir/lower/lower-expr.ts:passType": "`typingFor(node).synthAt(node)` through `irType`",
  "src/ir/lower/lower-expr.ts:passTargetSteps":
    "`typingFor(lv).lvalueStepsAt(lv)` through `irType`",
  "src/ir/lower/lower-expr.ts:inferExprType":
    "the pass's type, plus the two §D7 REPRESENTATION rules for a ui element",
  "src/ir/lower/lower-expr.ts:unwrapGuardedIntrinsicReceiver":
    "reads only the suffix's call SHAPE to pick the receiver's representation; infers nothing",
};

/** The delegators must actually reach the pass — a census that only checked
 *  names would pass a delegator rewritten into a checker of its own. */
const MUST_READ_THE_PASS = [
  "src/language/type-system.ts:typeOfExpr",
  "src/language/type-system.ts:suffixType",
  "src/language/validators/statements.ts:lvalueType",
  "src/ir/lower/lower-expr.ts:passType",
  "src/ir/lower/lower-expr.ts:passTargetSteps",
  "src/ir/lower/lower-expr.ts:inferExprType",
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const rel = relative(ROOT, p);
    if (EXEMPT_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`))) continue;
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function scan(): Map<string, string> {
  const found = new Map<string, string>();
  for (const d of SCANNED) {
    for (const f of tsFiles(join(ROOT, d))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(FN)) {
        if (AST_PARAM.test(m[2] ?? "")) found.set(`${relative(ROOT, f)}:${m[1]}`, src);
      }
    }
  }
  return found;
}

function bodyOf(src: string, name: string): string {
  const start = src.search(new RegExp(`^(?:export )?function ${name}\\(`, "m"));
  const end = src.indexOf("\n}\n", start);
  return src.slice(start, end);
}

describe("M-T5.44 — one typing pass: no second type-inference path", () => {
  const found = scan();

  it("the scan reaches the real code", () => {
    // Vacuum guard: a scan that matched nothing would pass everything below.
    expect(found.size).toBeGreaterThanOrEqual(5);
    expect([...found.keys()]).toContain("src/ir/lower/lower-expr.ts:inferExprType");
  });

  it("no function outside the pass maps an AST node to a type, except the listed delegators", () => {
    const extra = [...found.keys()].filter((k) => !(k in ALLOWED)).sort();
    expect(
      extra,
      "A function that types an AST node outside src/language/typing/ is a second inference " +
        "path — the shape M-T5.44 removed.  Put the rule in the typing pass (elaborate.ts) and " +
        "read it with typingFor(node), or, if it is a pure read, add it to ALLOWED with why.",
    ).toEqual([]);
  });

  it("every allowlisted delegator still exists (the list only shrinks)", () => {
    const stale = Object.keys(ALLOWED).filter((k) => !found.has(k));
    expect(stale, "Delete these ALLOWED entries in the change that removed them").toEqual([]);
  });

  it("each delegator reads the pass", () => {
    for (const key of MUST_READ_THE_PASS) {
      const [, name] = key.split(":") as [string, string];
      const src = found.get(key);
      expect(src, `${key} is gone`).toBeDefined();
      expect(bodyOf(src!, name), `${key} must read the pass (typingFor / passType)`).toMatch(
        /typingFor\(/,
      );
    }
  });
});
