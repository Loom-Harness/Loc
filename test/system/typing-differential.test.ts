// The THREE-WAY typing differential (M-T5.44 slice 2, shadow mode).
//
// Loom types each expression by hand-kept copies: the language layer
// (`typeOf` over `envForNode`, read by the validators and the LSP) and the IR
// layer (`inferExprType` over the lowering `Env`, read by lowering). The single
// typing pass (`src/language/typing/`) is meant to replace both. Before any
// consumer moves to it, this differential asks all three the same question for
// every expression in the fleet and classifies each answer:
//
//   - `agree`          all three give the same type.
//   - `nobody-knows`   both old checkers fall open (language `unknown`, IR
//                      `string` placeholder) and so does the pass.
//   - `new-only`       both old checkers fall open; only the pass has a type.
//   - `new=ir`         the pass agrees with the IR; the language layer differs.
//                      Almost always the language layer failing open (`unknown`),
//                      i.e. a validator gate that is OFF on that expression today.
//   - `new=lang`       the pass agrees with the language layer; the IR differs —
//                      usually the IR's `string` fallback, or a deliberate IR
//                      representation choice (design §D7).
//   - `new-differs`    the old checkers agree and the pass does not: a pass bug
//                      until triaged otherwise.
//   - `conflict`       three different answers, at least two of them concrete.
//   - `not-lowered`    lowering never lowered the expression (no IR answer);
//                      compared against the language layer only.
//   - `declaration-name` the node is the head NAME of a chain whose head is a
//                      declaration, not a value (`Orders` in `Orders.getById(…)`,
//                      `Text` in `Text(…)`): it has no type by design.
//   - `unreached`      the pass's walk never typed the node: always a pass bug.
//
// The fleet is every tracked `.ddd` (corpus, e2e fixtures, examples,
// web/src/examples, journey, eval repros, docs models) plus every whole `.ddd`
// document written inline in a test file. Multi-file projects are parsed one
// file at a time (as #3125's census does), so cross-file names are unresolved
// for all three checkers alike.
//
// The IR answer comes from an observer on `lowerExpr` that sees each
// expression with the exact lowering `Env` it was lowered in — the hook is
// behaviour-free and unset outside this test.
//
// Diagnosis: `LOOM_TYPING_DIFF_REPORT=/tmp/r.json npx vitest run <this file>`
// writes every class count, the per-`$type` breakdown, the pass's `unknown`
// causes and samples per (class, $type, lang, ir, new) cell.

import * as fs from "node:fs";
import { type AstNode, AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { inferExprType, setLowerExprObserver } from "../../src/ir/lower/lower-expr.js";
import type { TypeIR } from "../../src/ir/types/loom-ir.js";
import {
  type Expression,
  isExpression,
  isMemberSuffix,
  isNameRef,
  isPostfixChain,
  type Model,
} from "../../src/language/generated/ast.js";
import type { DddType } from "../../src/language/type-system.js";
import { envForNode, typeOf } from "../../src/language/type-system.js";
import { tyKey, typingSession } from "../../src/language/typing/index.js";
import {
  dddSourceOf,
  inlineDddDocuments,
  trackedDddFiles,
  UNPARSEABLE_DDD,
} from "../_helpers/ddd-corpus.js";
import { parseString } from "../_helpers/index.js";

/** The pinned counts — read rather than JSON-imported (the repo compiles on a
 *  module setting where `import … with { type: "json" }` does not typecheck). */
const BASELINE = JSON.parse(
  fs.readFileSync(new URL("./typing-differential.baseline.json", import.meta.url), "utf8"),
) as { floors: { docs: number; expressions: number }; classes: Record<string, number> };

/** Classes pinned exactly / pinned as a ceiling (see the two gates below). */
const EXACT = ["unreached", "new-differs"] as const;
const CEILING = ["conflict", "nobody-knows", "new=lang", "not-lowered-differ"] as const;

/** The language layer's answer, in the shared key space (#3125's). */
function langKey(t: DddType | undefined): string {
  if (!t) return "unknown";
  switch (t.kind) {
    case "primitive":
      return `p:${t.name}`;
    case "id":
      return `id:${t.target.name}`;
    case "enum":
      return `enum:${t.ref.name}`;
    case "valueobject":
      return `vo:${t.ref.name}`;
    case "aggregate":
    case "entity":
    case "payload":
      return `rec:${t.ref.name}`;
    case "userclaim":
      return "rec:__User__";
    case "array":
      return `[${langKey(t.element)}]`;
    case "optional":
      return `${langKey(t.inner)}?`;
    case "action":
      return t.arg ? `action(${langKey(t.arg)})` : "action";
    case "any":
    case "unknown":
      return "unknown";
    case "slot":
    case "never":
      return t.kind;
  }
}

/** The IR layer's answer, in the shared key space. */
function irKey(t: TypeIR | undefined): string {
  if (!t) return "unknown";
  switch (t.kind) {
    case "primitive":
      return `p:${t.name}`;
    case "id":
      return `id:${t.targetName}`;
    case "enum":
      return `enum:${t.name}`;
    case "valueobject":
      return `vo:${t.name}`;
    case "entity":
      return `rec:${t.name}`;
    case "array":
      return `[${irKey(t.element)}]`;
    case "optional":
      return `${irKey(t.inner)}?`;
    case "genericInstance":
      return `${t.ctor}<${irKey(t.arg)}>`;
    case "union":
      return `union(${t.variants.map(irKey).join("|")})`;
    case "action":
      return t.arg ? `action(${irKey(t.arg)})` : "action";
    case "none":
    case "slot":
      return t.kind;
  }
}

type Klass =
  | "declaration-name"
  | "agree"
  | "nobody-knows"
  | "new-only"
  | "new=ir"
  | "new=lang"
  | "new-differs"
  | "conflict"
  | "not-lowered-agree"
  | "not-lowered-differ"
  | "unreached";

interface Tally {
  docs: number;
  unparsed: number;
  expressions: number;
  byClass: Record<string, number>;
  byClassType: Record<string, number>;
  newUnknownByCause: Record<string, number>;
  /** `container-type name` → count, for the pass's unresolved names. */
  unresolvedNames: Record<string, number>;
  samples: Record<string, string[]>;
}

/** A key with declaration names erased, so samples aggregate by shape. */
function shape(k: string): string {
  return k.replace(/(rec|vo|enum|id):[A-Za-z0-9_]+/g, "$1:_");
}

function bump(m: Record<string, number>, k: string): void {
  m[k] = (m[k] ?? 0) + 1;
}

async function differential(): Promise<Tally> {
  const tally: Tally = {
    docs: 0,
    unparsed: 0,
    expressions: 0,
    byClass: {},
    byClassType: {},
    newUnknownByCause: {},
    unresolvedNames: {},
    samples: {},
  };
  const sources: { name: string; text: string }[] = [
    ...trackedDddFiles()
      .filter((f) => f !== UNPARSEABLE_DDD)
      .map((f) => ({ name: f, text: dddSourceOf(f) })),
    ...inlineDddDocuments().map((d) => ({ name: `${d.file}:${d.line}`, text: d.text })),
  ];
  for (const src of sources) {
    let model: Model;
    try {
      model = (await parseString(src.text, { validate: false })).model;
    } catch {
      tally.unparsed++;
      continue;
    }
    tally.docs++;
    const session = typingSession([model]);
    const ir = new Map<Expression, string>();
    let inObserver = false;
    setLowerExprObserver((expr, env) => {
      if (inObserver || ir.has(expr)) return;
      inObserver = true;
      try {
        ir.set(expr, irKey(inferExprType(expr, env)));
      } catch {
        ir.set(expr, "(throws)");
      } finally {
        inObserver = false;
      }
    });
    try {
      lowerModel(model);
    } catch {
      // A model lowering cannot handle still has language + new answers.
    } finally {
      setLowerExprObserver(undefined);
    }
    for (const node of AstUtils.streamAst(model)) {
      if (!isExpression(node)) continue;
      tally.expressions++;
      let lang: string;
      try {
        lang = langKey(typeOf(node, envForNode(node)));
      } catch {
        lang = "(throws)";
      }
      const nt = session.synthAt(node);
      const neu = nt ? tyKey(nt) : "(unreached)";
      if (nt?.kind === "unknown") {
        bump(tally.newUnknownByCause, nt.cause);
        if (nt.cause === "unresolved-name" && isNameRef(node)) {
          let c: AstNode | undefined = node.$container;
          while (
            c &&
            (isExpression(c) ||
              c.$type.endsWith("Arg") ||
              c.$type.endsWith("Entry") ||
              c.$type.endsWith("Suffix"))
          )
            c = c.$container;
          bump(tally.unresolvedNames, `${c?.$type} ${node.name}`);
        }
        if (nt.cause === "unresolved-member" && isPostfixChain(node)) {
          const path = node.suffixes.map((x) => (isMemberSuffix(x) ? x.member : "()"));
          bump(tally.unresolvedNames, `.member ${path.join(".")}`);
        }
      }
      const irk = ir.get(node);
      let klass: Klass;
      if (!nt) {
        klass = "unreached";
        bump(
          tally.unresolvedNames,
          `UNREACHED ${node.$type} ${src.name} ${node.$container?.$type}`,
        );
      } else if (nt.kind === "unknown" && nt.cause === "not-a-value") klass = "declaration-name";
      else if (irk === undefined) klass = neu === lang ? "not-lowered-agree" : "not-lowered-differ";
      else if (neu === lang && neu === irk) klass = "agree";
      else if (lang === "unknown" && irk === "p:string" && neu !== "p:string") {
        // Both old checkers fell open (the language layer's `unknown`, the IR's
        // `string` placeholder): the pass either fails too, or is the only one
        // that knows.
        klass = neu === "unknown" ? "nobody-knows" : "new-only";
      } else if (neu === irk) klass = "new=ir";
      else if (neu === lang) klass = "new=lang";
      else if (lang === irk) klass = "new-differs";
      else klass = "conflict";
      bump(tally.byClass, klass);
      bump(tally.byClassType, `${klass} ${node.$type}`);
      if (klass !== "agree" && klass !== "not-lowered-agree" && klass !== "declaration-name") {
        const cell = `${klass} | ${node.$type} | lang=${shape(lang)} ir=${shape(irk ?? "-")} new=${shape(neu)}`;
        tally.samples[cell] ??= [];
        const list = tally.samples[cell];
        if (list.length < 4)
          list.push(`${src.name}: ${(node.$cstNode?.text ?? "<synth>").slice(0, 100)}`);
      }
    }
  }
  return tally;
}

describe("M-T5.44 shadow mode — three-way typing differential", () => {
  let tally: Tally;

  it("runs over the whole fleet", async () => {
    tally = await differential();
    const out = process.env.LOOM_TYPING_DIFF_REPORT;
    if (out) {
      const sorted = (m: Record<string, number>) =>
        Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]));
      fs.writeFileSync(
        out,
        JSON.stringify(
          {
            ...tally,
            byClass: sorted(tally.byClass),
            byClassType: sorted(tally.byClassType),
            newUnknownByCause: sorted(tally.newUnknownByCause),
            unresolvedNames: Object.fromEntries(
              Object.entries(sorted(tally.unresolvedNames)).slice(0, 300),
            ),
          },
          null,
          1,
        ),
      );
    }
    // Vacuum guards: a fleet that silently shrank would make every count below meaningless.
    expect(tally.docs).toBeGreaterThan(BASELINE.floors.docs);
    expect(tally.expressions).toBeGreaterThan(BASELINE.floors.expressions);
  }, 900_000);

  it("the pass reaches every expression", () => {
    expect(tally.byClass.unreached ?? 0).toBe(0);
  });

  // `new-differs` rows are each TRIAGED (the PR that pins a count names what
  // the rows are), so the count is exact: a new one is a pass bug or a new
  // defect, and one that disappears must lower the pin.
  it("the triaged classes match their pinned counts exactly", () => {
    for (const k of EXACT)
      expect({ [k]: tally.byClass[k] ?? 0 }).toEqual({ [k]: BASELINE.classes[k] });
  });

  // The failure classes may not GROW. A band absorbs fixtures other PRs add
  // (every `.ddd` added anywhere adds expressions to every class); a real
  // regression in one of the three checkers moves a class by far more.
  it("the failure classes do not grow", () => {
    for (const k of CEILING) {
      const pinned = BASELINE.classes[k] ?? 0;
      const allowed = Math.ceil(pinned * 1.02) + 25;
      expect(
        tally.byClass[k] ?? 0,
        `${k}: pinned ${pinned}, allowed up to ${allowed}`,
      ).toBeLessThanOrEqual(allowed);
    }
  });
});
