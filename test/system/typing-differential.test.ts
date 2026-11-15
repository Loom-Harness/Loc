// The typing differential: the single typing pass against lowering.
//
// Validators and the LSP read the single typing pass (`src/language/typing/`)
// directly. Lowering copies the pass's types too, through `passType` over the
// lowering `Env`; a node the pass left unknown carries the `string` placeholder
// and is recorded, which fails the model (`loom.unresolved-type`). This
// differential asks both the same question for every expression in the fleet
// and classifies each answer:
//
//   - `agree`            the pass and lowering give the same type.
//   - `nobody-knows`     the pass has no type and lowering falls back to its
//                        `string` placeholder.
//   - `ir-differs`       the pass has a type and lowering gives another one —
//                        usually the `string` fallback, or a deliberate IR
//                        representation choice (design §D7).
//   - `not-lowered`      lowering never lowered the expression (no IR answer).
//   - `declaration-name` the node is the head NAME of a chain whose head is a
//                        declaration, not a value (`Orders` in `Orders.getById(…)`,
//                        `Text` in `Text(…)`): it has no type by design.
//   - `unreached`        the pass's walk never typed the node: always a pass bug.
//   - `test-statement`   an `ir-differs` answer inside a test body (an `expect(…)`
//                        assertion or a `test e2e` block, where `api.*` lives):
//                        test bodies lower through their own vocabulary, so
//                        the class is counted and reported but never fails.
//
// The fleet is every tracked `.ddd` (corpus, e2e fixtures, examples,
// web/src/examples, journey, docs models) plus every whole `.ddd`
// document written inline in a test file. Multi-file projects are parsed one
// file at a time (as #3125's census does), so cross-file names are unresolved
// for both alike.
//
// The IR answer comes from an observer on `lowerExpr` that sees each
// expression with the exact lowering `Env` it was lowered in — the hook is
// behaviour-free and unset outside this test.
//
// Diagnosis: `LOOM_TYPING_DIFF_REPORT=/tmp/r.json npx vitest run <this file>`
// writes every class count, the per-`$type` breakdown, the pass's `unknown`
// causes and samples per (class, $type, ir, new) cell.

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { type AstNode, AstUtils } from "langium";
import { describe, expect, it } from "vitest";
import { validate } from "../../src/api/index.js";
import { lowerModel } from "../../src/ir/lower/lower.js";
import { passTypeUnrecorded, setLowerExprObserver } from "../../src/ir/lower/lower-expr.js";
import type { TypeIR } from "../../src/ir/types/loom-ir.js";
import {
  type Expression,
  isExpression,
  isMemberSuffix,
  isNameRef,
  isPostfixChain,
  type Model,
} from "../../src/language/generated/ast.js";
import { tyKey, typingSession } from "../../src/language/typing/index.js";
import { dddSourceOf, inlineDddDocuments, trackedDddFiles } from "../_helpers/ddd-corpus.js";
import { parseString } from "../_helpers/index.js";

/** The pinned counts — read rather than JSON-imported (the repo compiles on a
 *  module setting where `import … with { type: "json" }` does not typecheck). */
const BASELINE = JSON.parse(
  fs.readFileSync(new URL("./typing-differential.baseline.json", import.meta.url), "utf8"),
) as {
  floors: { docs: number; expressions: number };
};

/** Classes pinned as a ceiling (see the gate below). */
const CEILING = ["nobody-knows", "ir-differs"] as const;

/** The pass's `unknown` cause that is not a hole: the head name of
 *  `Orders.getById(…)` has no type by design. */
const NOT_A_HOLE = "not-a-value";

/**
 * Per-document allowance for the failure classes and the pass's unknown
 * causes, keyed `"<doc> :: <class>"` (`<class>` is a CEILING class or
 * `unknown{<cause>}`).  A document may not exceed its allowance, a document
 * with no entry is allowed 0, and an entry above the document's count fails,
 * so the allowance only falls.
 *
 * It is per document, not one fleet-wide figure per class, on purpose: a
 * fleet-wide figure grows with every `.ddd` any change adds, so two changes
 * that each fit the band passed alone and failed together in the merge queue.
 * The fleet total of each class is therefore not pinned on its own; it is
 * bounded by the sum of the per-document allowances, which only falls.
 *
 * Two files:
 *   - `typing-differential.legacy.json` — the counts every document carried
 *     when entries started to need a reason.  FROZEN: an entry may be lowered
 *     or deleted, never raised or added; its key count may only fall
 *     (LEGACY_MAX_KEYS).
 *   - `typing-differential.allowance.json` — every other entry, each
 *     `{ "n": <count>, "why": "<the construct that differs, and why the IR
 *     representation is deliberate>" }`.  A pass-gap cause (`no-rule`,
 *     `unreached`: the pass has no rule, not an author error) also names the
 *     open issue that adds the rule: `"issue": "#NNNN"`.
 * A key lives in one file only.
 *
 * `LOOM_TYPING_DIFF_REBASELINE=1 npx vitest run <this file>` LOWERS entries
 * to the documents' counts and deletes the zeros, in both files.  It never
 * raises or adds one: growth is a reviewed edit with its reason.
 */
const LEGACY_FILE = new URL("./typing-differential.legacy.json", import.meta.url);
const ALLOWANCE_FILE = new URL("./typing-differential.allowance.json", import.meta.url);
const LEGACY = JSON.parse(fs.readFileSync(LEGACY_FILE, "utf8")) as Record<string, number>;
interface AllowanceEntry {
  n: number;
  why: string;
  issue?: string;
}
const ALLOWANCE = JSON.parse(fs.readFileSync(ALLOWANCE_FILE, "utf8")) as Record<
  string,
  AllowanceEntry
>;
/** The legacy file's key count: it may only fall. */
const LEGACY_MAX_KEYS = 1149;

/** `{"n": 3, "why": "…"}` — one entry on one line, spaced like the files. */
function entryText(v: unknown): string {
  if (typeof v !== "object" || v === null) return JSON.stringify(v);
  const fields = Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${JSON.stringify(x)}`);
  return `{${fields.join(", ")}}`;
}

/** One entry per line, sorted: the shape both files are written in. */
function writeEntries(file: URL, entries: Record<string, unknown>): void {
  const keys = Object.keys(entries).sort();
  fs.writeFileSync(
    file,
    `{\n${keys.map((k) => `  ${JSON.stringify(k)}: ${entryText(entries[k])}`).join(",\n")}\n}\n`,
  );
}

/** A stable key for an inline document: its test file plus a hash of its
 *  text, so an edit elsewhere in the file does not move it. */
function inlineDocKey(file: string, text: string): string {
  return `${file}#${createHash("sha1").update(text).digest("hex").slice(0, 10)}`;
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
  | "ir-differs"
  | "not-lowered"
  | "unreached"
  | "test-statement";

interface Tally {
  docs: number;
  unparsed: number;
  expressions: number;
  byClass: Record<string, number>;
  byClassType: Record<string, number>;
  newUnknownByCause: Record<string, number>;
  /** `"<doc> :: <class>"` → count, for the per-document allowance. */
  perDoc: Record<string, number>;
  /** `container-type name` → count, for the pass's unresolved names. */
  unresolvedNames: Record<string, number>;
  samples: Record<string, string[]>;
  /** `"<doc> :: <class>"` → up to 6 nodes of that class, for the report: what
   *  an allowance entry's `why` has to name. */
  docSamples: Record<string, string[]>;
  /** Each document whose lowering read a value the pass has no RULE for
   *  (`no-rule`, or a node it never reached) — a gap in the pass, as opposed
   *  to an author error it reports as unresolved. */
  untypedDocs: { name: string; text: string }[];
}

/** A key with declaration names erased, so samples aggregate by shape. */
function shape(k: string): string {
  return k.replace(/(rec|vo|enum|id):[A-Za-z0-9_]+/g, "$1:_");
}

function bump(m: Record<string, number>, k: string): void {
  m[k] = (m[k] ?? 0) + 1;
}

/** The unknown causes that mean the pass has no rule, not that the author
 *  wrote something unresolvable.  (`contextual-lambda` — nothing gives a
 *  lambda's parameter a type — is the author's to fix, and the backstop's
 *  message says so.) */
const PASS_GAPS: ReadonlySet<string> = new Set(["no-rule", "unreached"]);

/** Inside a test body: an `expect(…)` assertion, or anywhere in a `test e2e`
 *  block (the only place `api.*` is in scope). */
function inTestBody(node: AstNode): boolean {
  for (let c: AstNode | undefined = node; c; c = c.$container)
    if (c.$type === "ExpectStmt" || c.$type === "TestE2E") return true;
  return false;
}

/** What is wrong with the two allowance files' shape (counts aside). */
function allowanceProblems(
  allowance: Record<string, AllowanceEntry>,
  legacy: Record<string, number>,
): string[] {
  const out: string[] = [];
  for (const [k, e] of Object.entries(allowance)) {
    if (typeof e !== "object" || e === null || typeof e.n !== "number") {
      out.push(`${k}: must be { "n": <count>, "why": "…" }`);
      continue;
    }
    if (typeof e.why !== "string" || e.why.trim().length < 12)
      out.push(`${k}: "why" must name the construct that differs`);
    const cause = /:: unknown\{(.+)\}$/.exec(k)?.[1];
    if (cause && PASS_GAPS.has(cause) && !/^#\d+$/.test(e.issue ?? ""))
      out.push(`${k}: a pass gap (no rule in the typing pass) needs "issue": "#NNNN"`);
    if (Object.hasOwn(legacy, k)) out.push(`${k}: in both files — keep one`);
  }
  const n = Object.keys(legacy).length;
  if (n > LEGACY_MAX_KEYS)
    out.push(
      `typing-differential.legacy.json holds ${n} keys, above its frozen ${LEGACY_MAX_KEYS}: new entries go in allowance.json with a reason`,
    );
  return out;
}

async function differential(): Promise<Tally> {
  const tally: Tally = {
    docs: 0,
    unparsed: 0,
    expressions: 0,
    byClass: {},
    byClassType: {},
    newUnknownByCause: {},
    perDoc: {},
    unresolvedNames: {},
    samples: {},
    docSamples: {},
    untypedDocs: [],
  };
  const sources: { name: string; key: string; text: string }[] = [
    ...trackedDddFiles().map((f) => ({ name: f, key: f, text: dddSourceOf(f) })),
    ...inlineDddDocuments().map((d) => ({
      name: `${d.file}:${d.line}`,
      key: inlineDocKey(d.file, d.text),
      text: d.text,
    })),
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
        ir.set(expr, irKey(passTypeUnrecorded(expr, env)));
      } catch {
        ir.set(expr, "(throws)");
      } finally {
        inObserver = false;
      }
    });
    let passGap = false;
    try {
      passGap = lowerModel(model).unresolvedTypes.some((u) => PASS_GAPS.has(u.cause));
    } catch {
      // A model lowering cannot handle still has language + new answers.
    } finally {
      setLowerExprObserver(undefined);
    }
    for (const node of AstUtils.streamAst(model)) {
      if (!isExpression(node)) continue;
      tally.expressions++;
      const nt = session.synthAt(node);
      const neu = nt ? tyKey(nt) : "(unreached)";
      if (nt?.kind === "unknown") {
        bump(tally.newUnknownByCause, nt.cause);
        if (nt.cause !== NOT_A_HOLE) bump(tally.perDoc, `${src.key} :: unknown{${nt.cause}}`);
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
      else if (irk === undefined) klass = "not-lowered";
      else if (neu === irk) klass = "agree";
      else if (nt.kind === "unknown" && irk === "p:string") klass = "nobody-knows";
      else if (inTestBody(node)) klass = "test-statement";
      else klass = "ir-differs";
      bump(tally.byClass, klass);
      if ((CEILING as readonly string[]).includes(klass)) {
        const key = `${src.key} :: ${klass}`;
        bump(tally.perDoc, key);
        tally.docSamples[key] ??= [];
        if (tally.docSamples[key].length < 6)
          tally.docSamples[key].push(
            `${node.$type} ir=${irk} pass=${neu}: ${(node.$cstNode?.text ?? "<synth>").slice(0, 80)}`,
          );
      }
      bump(tally.byClassType, `${klass} ${node.$type}`);
      if (klass !== "agree" && klass !== "not-lowered" && klass !== "declaration-name") {
        const cell = `${klass} | ${node.$type} | ir=${shape(irk ?? "-")} new=${shape(neu)}`;
        tally.samples[cell] ??= [];
        const list = tally.samples[cell];
        if (list.length < 4)
          list.push(`${src.name}: ${(node.$cstNode?.text ?? "<synth>").slice(0, 100)}`);
      }
    }
    if (passGap) tally.untypedDocs.push(src);
  }
  return tally;
}

describe("typing differential: the pass against lowering (and the unknown ratchet)", () => {
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

  // The hard zero: lowering never reads a value the pass has no rule for,
  // unless the model is wrong for some other reason.  Each document in the
  // bucket must carry an error OTHER than `loom.unresolved-type` — that one is
  // the backstop, so a model refused only by it names a gap in the pass.
  it("no valid model holds a value the pass has no rule for", async () => {
    const valid: string[] = [];
    for (const doc of tally.untypedDocs) {
      const report = await validate(doc.text);
      const own = report.diagnostics.filter(
        (d) => d.severity === "error" && d.code !== "loom.unresolved-type",
      );
      if (own.length === 0) valid.push(doc.name);
    }
    expect(valid).toEqual([]);
  }, 600_000);

  it("the pass reaches every expression", () => {
    expect(tally.byClass.unreached ?? 0).toBe(0);
  });

  // The failure classes and the pass's unknowns may not GROW, document by
  // document (see ALLOWANCE).  Growth names the document and the class;
  // a drain names the entry to lower.
  it("each document's failure classes and unknowns only fall", () => {
    if (process.env.LOOM_TYPING_DIFF_REBASELINE) {
      // Lower only: an entry above the document's count drops to it, a zero
      // is deleted, nothing is raised or added.
      const lower = <T>(m: Record<string, T>, n: (v: T) => number, set: (v: T, n: number) => T) =>
        Object.fromEntries(
          Object.entries(m).flatMap(([k, v]) => {
            const have = tally.perDoc[k] ?? 0;
            if (have === 0) return [];
            return [[k, have < n(v) ? set(v, have) : v]];
          }),
        );
      writeEntries(
        LEGACY_FILE,
        lower(
          LEGACY,
          (v) => v,
          (_v, n) => n,
        ),
      );
      writeEntries(
        ALLOWANCE_FILE,
        lower(
          ALLOWANCE,
          (v) => v.n,
          (v, n) => ({ ...v, n }),
        ),
      );
      return;
    }
    const allowed = (k: string): number => ALLOWANCE[k]?.n ?? LEGACY[k] ?? 0;
    const keys = new Set([
      ...Object.keys(tally.perDoc),
      ...Object.keys(ALLOWANCE),
      ...Object.keys(LEGACY),
    ]);
    const over: string[] = [];
    const stale: string[] = [];
    for (const k of [...keys].sort()) {
      const n = tally.perDoc[k] ?? 0;
      const a = allowed(k);
      if (n > a) over.push(`${k}: ${n} > allowed ${a}`);
      else if (n < a) stale.push(n === 0 ? `delete ${JSON.stringify(k)}` : `${k}: ${n}, was ${a}`);
    }
    expect(
      over,
      "typing failure class / unknown cause GREW in these documents (an unlisted document is " +
        "allowed 0).  Fix the typing, or — for a deliberate IR representation choice — add an " +
        'entry to test/system/typing-differential.allowance.json: { "n": <count>, "why": "<the ' +
        'construct>" }, plus "issue" for a no-rule / unreached gap.  ' +
        "Samples: LOOM_TYPING_DIFF_REPORT=/tmp/r.json.\n" +
        over.join("\n"),
    ).toEqual([]);
    expect(
      stale,
      "allowance entries above the document's count — lower them " +
        "(LOOM_TYPING_DIFF_REBASELINE=1 lowers both files, never raises):\n" +
        stale.join("\n"),
    ).toEqual([]);
  });

  it("every allowance entry says why, a pass gap names its issue, and legacy stays frozen", () => {
    expect(allowanceProblems(ALLOWANCE, LEGACY)).toEqual([]);
  });

  it("refuses an unexplained entry, a pass gap without an issue, and a grown legacy file", () => {
    const gap = "x.ddd :: unknown{no-rule}";
    expect(
      allowanceProblems({ [gap]: { n: 1, why: "the page: object literal of a paged read" } }, {}),
    ).toEqual([`${gap}: a pass gap (no rule in the typing pass) needs "issue": "#NNNN"`]);
    expect(allowanceProblems({ "x.ddd :: ir-differs": { n: 1, why: "" } }, {})).toEqual([
      'x.ddd :: ir-differs: "why" must name the construct that differs',
    ]);
    expect(allowanceProblems({ "x.ddd :: ir-differs": 3 as never }, {})).toEqual([
      'x.ddd :: ir-differs: must be { "n": <count>, "why": "…" }',
    ]);
    const both = "y.ddd :: ir-differs";
    expect(
      allowanceProblems(
        { [both]: { n: 1, why: "the money fold returns a decimal" } },
        { [both]: 1 },
      ),
    ).toEqual([`${both}: in both files — keep one`]);
    const grown = Object.fromEntries(
      Array.from({ length: LEGACY_MAX_KEYS + 1 }, (_, i) => [`d${i}.ddd :: ir-differs`, 1]),
    );
    expect(allowanceProblems({}, grown)).toEqual([
      `typing-differential.legacy.json holds ${LEGACY_MAX_KEYS + 1} keys, above its frozen ${LEGACY_MAX_KEYS}: new entries go in allowance.json with a reason`,
    ]);
  });
});
