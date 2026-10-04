// The IR ⇄ language type-agreement census.
//
// Loom types every `let` twice. The LANGUAGE layer (`src/language/type-system.ts`,
// via `envForNode`) types it for the validators and the LSP; the IR layer
// (`src/ir/lower/`, via `inferExprType` + the workflow lowerer) types it for the
// backends. Nothing forces the two to agree, and where they disagree one of them
// is silently wrong: either a validator check is suppressed because the
// language side could not type the name (`unknown` / unbound — every type gate
// stands down on that, see `unknown-cascade-census.test.ts`), or the backend is
// emitting code against a type the language never checked.
//
// This census joins the two over every `let` in the tracked `.ddd` corpus and
// pins the disagreements on a shrink-only baseline.
//
// THE JOIN. Every lowered IR statement carries an `origin` (`src/ir/lower/
// origin.ts`): the `$cstNode` span of the AST statement it came from, or the
// `with X(...)` call site for a macro-synthesised one. The census keys both
// sides by that span start, so a `let` joins exactly the IR statement lowered
// from it, whatever container it sits in (an earlier pass keyed by the
// ancestor-name chain and joined only 820 of 1 385 lets: the IR tree and the
// AST tree name their containers differently, and workflow lets are not
// `kind: "let"` in the IR at all — they lower to `expr-let` / `factory-let` /
// `repo-let` / `repo-run`). A macro-synthesised let has no span of its own
// (its origin is the `with X(...)` call site), so it keys by call site +
// declaring member name + let name + ordinal — the 41 `scaffoldHandlers` /
// `scaffoldPaged` handler lets in today's corpus all join that way.
//
// Measured on main @ bce7f4093: 1 385 AST lets, 1 379 joined (99.6 %; the
// ancestor-chain key joined 820). The 7 unjoined rows are each in a named
// category (UNJOINED_BASELINE); an unexplained one fails the census.
//
// THE CLASSES (a joined row whose two keys differ):
//   - `language-fails-open` — the language side has no type (the name is not
//     bound by `envForNode`, or binds to `unknown`) while the IR typed it.
//   - `ir-string-fallback`  — the IR says `string` and that `string` is the
//     default `inferExprType` returns for something it could not resolve: the
//     initializer's receiver spine bottoms out at an unresolved name
//     (`refKind: "unknown"`), a `free` call, or a let that was itself a
//     fallback. (Or the language side knows a non-string type.) This is not
//     knowledge; it is the IR failing open too.
//   - `both-concrete-differ` — both layers produced a real type and they differ.
//
// NORMALISATION. Both sides reduce to one key space. `aggregate`/`entity`/
// `payload` (event + payload records) → `rec:` — the IR has no payload kind and
// types a transport record as an `entity` marker (`lower-types.ts`).
// `userclaim` → `rec:__User__` (the IR's `USER_SHAPE_NAME`). `id` keys by target
// name on both sides. The language type system has no union or generic kind, so
// an IR `union(...)` / `paged<...>` can never be matched by it; those rows are
// classified as they fall and called out below rather than normalised away.
//
// Diagnosis: `LOOM_CENSUS_REPORT=/tmp/r.json npx vitest run <this file>` writes
// every row (key, container, both types, class, source text) as JSON.

import * as fs from "node:fs";
import { type AstNode, AstUtils } from "langium";
import { beforeAll, describe, expect, it } from "vitest";
import { lowerModel } from "../../src/ir/lower/lower.js";
import type { ExprIR, TypeIR } from "../../src/ir/types/loom-ir.js";
import { isLetStmt, isSystem, type LetStmt, type Model } from "../../src/language/generated/ast.js";
import { originOf } from "../../src/language/macro-origin.js";
import type { DddType } from "../../src/language/type-system.js";
import { envForNode } from "../../src/language/type-system.js";
import { dddSourceOf, trackedDddFiles, UNPARSEABLE_DDD } from "../_helpers/ddd-corpus.js";
import { parseString } from "../_helpers/index.js";

/** The language layer's let type, in the shared key space. */
function langTypeKey(t: DddType | undefined): string {
  if (!t) return "(unbound)";
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
      return `[${langTypeKey(t.element)}]`;
    case "optional":
      return `${langTypeKey(t.inner)}?`;
    case "action":
      return t.arg ? `action(${langTypeKey(t.arg)})` : "action";
    case "slot":
    case "any":
    case "never":
    case "unknown":
      return t.kind;
  }
}

/** The IR layer's let type, in the shared key space. */
function irTypeKey(t: TypeIR | undefined): string {
  if (!t) return "(none)";
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
      return `[${irTypeKey(t.element)}]`;
    case "optional":
      return `${irTypeKey(t.inner)}?`;
    case "genericInstance":
      return `${t.ctor}<${irTypeKey(t.arg)}>`;
    case "union":
      return `union(${t.variants.map(irTypeKey).join("|")})`;
    case "action":
      return t.arg ? `action(${irTypeKey(t.arg)})` : "action";
    case "none":
    case "slot":
      return t.kind;
  }
}

/** Language-side keys that carry no type information. */
const LANG_UNINFORMATIVE = new Set(["(unbound)", "(other-binding)", "(throws)", "unknown", "any"]);

/** Every IR statement kind that binds a `let`: the statement-body `let`, and
 *  the four shapes the workflow lowerer splits a workflow `let` into. */
const IR_LET_KINDS = new Set(["let", "expr-let", "factory-let", "repo-let", "repo-run"]);

type Origin =
  | { kind: "source"; path: string; span: { start: number } }
  | { kind: "macro"; macro: string; call: { path: string; span: { start: number } } }
  | { kind: "derived"; reason: string }
  | undefined;

type IrLet = { key: string; type: string; fallback: boolean; irKind: string };
type AstLet = { key: string; lang: string; container: string; nested: boolean; text: string };

type Klass = "language-fails-open" | "ir-string-fallback" | "both-concrete-differ";
type Unjoined = "ir-hoisted-let" | "fragment-not-lowered" | "UNEXPLAINED";

type Row = {
  file: string;
  key: string;
  container?: string;
  nested?: boolean;
  lang?: string;
  ir?: string;
  irKind?: string;
  klass?: Klass | "agree";
  unjoined?: Unjoined;
  text?: string;
};

function irLetType(o: Record<string, unknown>): string {
  if (o.kind === "factory-let") return `rec:${o.aggName as string}`;
  if (o.kind === "repo-let" || o.kind === "repo-run") return irTypeKey(o.returnType as TypeIR);
  return irTypeKey(o.type as TypeIR);
}

/** Does the initializer's receiver spine bottom out at something lowering
 *  could not resolve? Then an IR `string` is `inferExprType`'s default, not a
 *  type. `fallbackLets` carries lets in scope already judged to be fallbacks,
 *  so `let read = api.x.getById(c)` and `c.name` inherit the verdict. */
function spineIsUnresolved(
  expr: ExprIR | undefined,
  fallbackLets: ReadonlyMap<string, boolean>,
): boolean {
  let e = expr;
  for (;;) {
    if (!e) return false;
    switch (e.kind) {
      case "member":
      case "method-call":
        e = e.receiver;
        continue;
      case "paren":
        e = e.inner;
        continue;
      case "ref":
        return (
          e.refKind === "unknown" || (e.refKind === "let" && fallbackLets.get(e.name) === true)
        );
      case "call":
        return e.callKind === "free";
      default:
        return false;
    }
  }
}

/** Every let-binding IR statement in a lowered model, keyed by its origin.
 *  A generic deep walk: lets sit in operations, handlers, workflows, tests,
 *  e2e blocks, projections …, and the census must not depend on an
 *  enumeration of those that would rot when a new container appears. */
function irLets(root: unknown, docPath: string): IrLet[] {
  const out: IrLet[] = [];
  const seen = new Set<unknown>();
  const ord = new Map<string, number>();
  const walk = (v: unknown, member: string, scope: Map<string, boolean>): void => {
    if (!v || typeof v !== "object" || seen.has(v)) return;
    seen.add(v);
    if (Array.isArray(v)) {
      // A statement list is a lexical scope: lets bound in it are visible to
      // later siblings and to nested blocks, not to the enclosing list.
      const inner = new Map(scope);
      for (const x of v) walk(x, member, inner);
      return;
    }
    const o = v as Record<string, unknown>;
    if (typeof o.kind === "string" && IR_LET_KINDS.has(o.kind) && typeof o.name === "string") {
      const origin = o.origin as Origin;
      let key: string;
      if (origin?.kind === "source") {
        key = `src:${origin.path === docPath ? "" : origin.path}@${origin.span.start}`;
      } else {
        const base =
          origin?.kind === "macro"
            ? `macro:${origin.macro}@${origin.call.span.start}/${member}/${o.name}`
            : `noorigin:${origin?.kind ?? "-"}/${member}/${o.name}`;
        const i = ord.get(base) ?? 0;
        ord.set(base, i + 1);
        key = `${base}#${i}`;
      }
      const type = irLetType(o);
      const fallback =
        type === "p:string" && spineIsUnresolved(o.expr as ExprIR | undefined, scope);
      scope.set(o.name, fallback);
      out.push({ key, type, fallback, irKind: o.kind });
    }
    const nextMember =
      typeof o.name === "string" && !IR_LET_KINDS.has(String(o.kind)) ? o.name : member;
    for (const [k, x] of Object.entries(o)) {
      if (k === "type" || k === "returnType" || k === "origin") continue;
      walk(x, nextMember, scope);
    }
  };
  walk(root, "", new Map());
  return out;
}

/** The let's executable container (`TestE2E`, `CommandHandler`, …) — the first
 *  ancestor that is not a nested block / statement — and whether it sits in a
 *  nested block (an `if` / `for` / `match` arm body). */
function containerOf(n: LetStmt): { container: string; nested: boolean; member: string } {
  let nested = false;
  let container = "";
  let member = "";
  for (let c: AstNode | undefined = n.$container; c; c = c.$container) {
    if (!container) {
      const t = c.$type;
      if (t.endsWith("Stmt") || t.endsWith("Statement") || t.endsWith("Arm")) {
        nested = true;
        continue;
      }
      container = t;
    }
    const nm = (c as { name?: unknown }).name;
    if (!member && typeof nm === "string") member = nm;
  }
  return { container, nested, member };
}

function astLets(model: AstNode): AstLet[] {
  const out: AstLet[] = [];
  const ord = new Map<string, number>();
  for (const n of AstUtils.streamAllContents(model)) {
    if (!isLetStmt(n)) continue;
    const { container, nested, member } = containerOf(n);
    const tok = originOf(n);
    let key: string;
    if (!tok && n.$cstNode) key = `src:@${n.$cstNode.offset}`;
    else {
      const base = tok
        ? `macro:${tok.macroName}@${tok.callNode.$cstNode?.offset}/${member}/${n.name}`
        : `nocst:/${member}/${n.name}`;
      const i = ord.get(base) ?? 0;
      ord.set(base, i + 1);
      key = `${base}#${i}`;
    }
    let lang: string;
    try {
      const b = envForNode(n).resolve(n.name);
      // Bound to a DIFFERENT declaration (a same-named param or a later
      // shadowing let) is as uninformative as unbound — it is not this let's type.
      lang = !b ? "(unbound)" : b.origin === n ? langTypeKey(b.type) : "(other-binding)";
    } catch {
      lang = "(throws)";
    }
    out.push({ key, lang, container, nested, text: (n.$cstNode?.text ?? "").slice(0, 160) });
  }
  return out;
}

function classify(lang: string, ir: IrLet): Klass | "agree" {
  if (lang === ir.type) return "agree";
  if (ir.type === "p:string" && (ir.fallback || !LANG_UNINFORMATIVE.has(lang)))
    return "ir-string-fallback";
  if (LANG_UNINFORMATIVE.has(lang)) return "language-fails-open";
  return "both-concrete-differ";
}

/** The `$cstNode` start offset of every statement-shaped AST node, so an
 *  IR-only let can be checked against what the source has at its origin. */
function statementOffsets(model: AstNode): Map<number, string> {
  const m = new Map<number, string>();
  for (const n of AstUtils.streamAllContents(model)) {
    if (n.$cstNode && /Stmt$|Statement$/.test(n.$type) && !m.has(n.$cstNode.offset))
      m.set(n.$cstNode.offset, n.$type);
  }
  return m;
}

async function runCensus(): Promise<{
  files: number;
  parsed: number;
  lowerFail: string[];
  rows: Row[];
}> {
  const files = trackedDddFiles().filter((f) => f !== UNPARSEABLE_DDD);
  const rows: Row[] = [];
  const lowerFail: string[] = [];
  let parsed = 0;
  for (const file of files) {
    let model: Model | undefined;
    try {
      model = (await parseString(dddSourceOf(file), { validate: false })).model as Model;
    } catch {
      continue;
    }
    if (!model) continue;
    parsed++;
    let ir: unknown;
    try {
      ir = lowerModel(model);
    } catch {
      lowerFail.push(file);
      continue;
    }
    const docPath = AstUtils.getDocument(model).uri.path;
    const ast = new Map(astLets(model).map((x) => [x.key, x]));
    const irs = new Map<string, IrLet[]>();
    for (const x of irLets(ir, docPath)) irs.set(x.key, [...(irs.get(x.key) ?? []), x]);
    const hasSystem = AstUtils.streamAllContents(model).some(isSystem);
    let stmtAt: Map<number, string> | undefined;

    for (const key of new Set([...ast.keys(), ...irs.keys()])) {
      const a = ast.get(key);
      const copies = irs.get(key);
      // A block lowered twice (a fullstack `test e2e` lowers once per spec
      // kind) yields identical copies; collapse them. Copies that DISAGREE
      // would be an IR self-inconsistency — kept distinct so the row shows it.
      const distinct = copies ? [...new Map(copies.map((c) => [c.type, c])).values()] : [];
      const ir = distinct.length === 1 ? distinct[0] : undefined;
      const row: Row = {
        file,
        key,
        container: a?.container,
        nested: a?.nested,
        lang: a?.lang,
        ir: copies ? distinct.map((c) => c.type).join(" / ") : undefined,
        irKind: copies?.[0]?.irKind,
        text: a?.text,
      };
      if (a && ir) row.klass = classify(a.lang, ir);
      else if (a && distinct.length > 1) row.klass = "both-concrete-differ";
      else if (a) {
        // A multi-file FRAGMENT (no `system` of its own — e.g. erp/deploy.ddd)
        // parsed alone: `lowerModel` folds top-level `test e2e` blocks only
        // into a system, so with none there is nothing to lower them into.
        row.unjoined =
          !hasSystem && a.container === "TestE2E" ? "fragment-not-lowered" : "UNEXPLAINED";
      } else {
        // An IR let with no AST let at its origin: lowering hoisted a
        // sub-expression of some OTHER statement into a synthetic binding
        // (e.g. `Parts.getById(l.partId).consume(..)` in a workflow `for`).
        stmtAt ??= statementOffsets(model);
        const m = /^src:@(\d+)$/.exec(key);
        const at = m ? stmtAt.get(Number(m[1])) : undefined;
        row.unjoined = at && at !== "LetStmt" ? "ir-hoisted-let" : "UNEXPLAINED";
      }
      rows.push(row);
    }
  }
  return { files: files.length, parsed, lowerFail, rows };
}

// ---------------------------------------------------------------------------
// The baseline. Shrink-only, exact, both ways: a count that GROWS is a new
// disagreement (or a new unjoined row); a count that FALLS is progress that
// must be banked by lowering the row in the same change.
// ---------------------------------------------------------------------------

/** `<container>/<class>` → exact count of joined lets that disagree. */
const DISAGREEMENT_BASELINE: Record<string, number> = {
  // ── language-fails-open: the let is never BOUND (`envForNode` has no arm) ──
  // (Unit `test` and `test e2e` lets are pinned as TOTAL gaps in
  // TOTAL_GAP_CONTAINERS below, not counted here.)
  // No CommandHandler / QueryHandler / FunctionDecl arm (params AND lets
  // unbound). Owned by Track A of the census work.
  "CommandHandler/language-fails-open": 28,
  "QueryHandler/language-fails-open": 25,
  "FunctionDecl/language-fails-open": 3,
  // A projection's `on(e: E) { … }` is `ProjectionOn`, not `OnDecl`, so the
  // OnDecl arm never matches it: `let stamped = e.at` (IR: datetime).
  "ProjectionOn/language-fails-open": 1,
  // `addTypedLets` binds only a body's TOP-LEVEL lets; a let inside a `for` /
  // `if` block of a workflow `create` or an `on` reactor is never bound.
  "WorkflowCreateDecl+nested/language-fails-open": 6,
  "OnDecl+nested/language-fails-open": 2,
  // ── language-fails-open: bound, but `typeOf` returns `unknown` ──
  // Top-level workflow lets whose INITIALIZER the language cannot type:
  // `Repo.run(<Retrieval>(..))` (44, IR: [rec:X]), a `match` expression (5,
  // IR: string), a resource verb `files.get(..)` (4, IR: string), and a typed
  // remote-api op `orders.getOrderById(..)` (5, IR: rec / paged<> / union).
  "WorkflowCreateDecl/language-fails-open": 58,
  // ── ir-string-fallback: IR `string` is `inferExprType`'s unresolved default ──
  // `let x = Foos.getById(f)` where `Foos` is another context's repository
  // (eval/repro/wf-cross-context-repo.ddd) — unresolved, defaulted to string.
  "WorkflowCreateDecl/ir-string-fallback": 1,
  // ── both-concrete-differ ──
  // `let o = Orders.locate(ref)`: the IR types the `locate` find as
  // `union(Order|NotFound)`; the language says `Order`. `DddType` has NO union
  // kind, so the language collapses the declared error variant to the success
  // type — a representability gap in the type system, not a census mapping
  // gap (there is no faithful key to normalise either side to).
  // examples/showcase.ddd ×1, elixir-vanilla-build/vanilla-workflow-unused-let.ddd ×4.
  "WorkflowCreateDecl/both-concrete-differ": 5,
};

/** Containers where EVERY let fails for one structural reason. These are pinned
 *  as a total gap rather than an exact count: corpus growth there (every new
 *  test adds lets) is not a regression, and an exact count would turn this
 *  census red on every fixture added anywhere in the repo. The invariant is
 *  instead: NO let in the container agrees, and every let sits in one of the
 *  listed classes. A real fix (any let starting to agree) or a drift into an
 *  unexpected class turns it red, and the fix must move the container out of
 *  this table and into exact DISAGREEMENT_BASELINE rows in the same change.
 *  `minRows` is a vacuum floor so a broken walker cannot pass by finding none. */
const TOTAL_GAP_CONTAINERS: Record<string, { classes: string[]; minRows: number; why: string }> = {
  // `test e2e`: the e2e lowering env is EMPTY by design (`lowerE2E`, lower.ts:
  // "bare-name lookups would mostly be unknown"), so `api.orders.create(..)`
  // roots at an unresolved `api` ref and the IR types it `string`; the language
  // side has no TestE2E arm, so it is unbound too. Neither layer types these
  // lets — the IR's string only looks like a type. ~917 lets on bce7f4093.
  TestE2E: {
    classes: ["ir-string-fallback"],
    minRows: 500,
    why: "neither layer types e2e lets (empty lowering scope; no envForNode arm)",
  },
  // unit `test`: no `envForNode` arm, so no let is bound (the IR types them:
  // `Order.create(..)` → rec:Order, `Money(..)` → vo:Money) — owned by #3092.
  // The one ir-string-fallback is `let found = Order.findById(o.id)`: no such
  // static on an aggregate, so the IR defaults it to string. ~102 lets.
  TestBlock: {
    classes: ["language-fails-open", "ir-string-fallback"],
    minRows: 50,
    why: "no envForNode arm for a unit test body (#3092 adds it)",
  },
};

/** Unjoined lets, by category → exact count. `UNEXPLAINED` must stay absent. */
const UNJOINED_BASELINE: Record<string, number> = {
  // web/src/examples/erp/deploy.ddd: a multi-file fragment with no `system`
  // of its own. Parsed alone, `lowerModel` has no system to fold its top-level
  // `test e2e` blocks into, so their 6 lets never reach the IR. A census-scope
  // artefact (the file is lowered for real together with erp/main.ddd).
  "fragment-not-lowered": 6,
  // eval/repro/wf-for-let-d.ddd: `for l in ls { Parts.getById(l.partId).consume(l.qty) }`
  // — the workflow lowerer hoists the load into a synthetic `expr-let` whose
  // origin is that call statement; there is no source `let` to join.
  "ir-hoisted-let": 1,
};

/** Vacuum floors: the census must actually reach the corpus. */
const MIN_FILES = 500;
const MIN_JOINED = 1300;
const MIN_AGREE = 200;

/** The baseline cell a row counts in: its container, split by whether the let
 *  sits in a nested block — `envForNode` binds only TOP-LEVEL body lets
 *  (`addTypedLets` iterates the body list, not nested blocks), so a nested let
 *  fails open for a different reason than its container's top-level ones, and
 *  is fixed by a different change. */
function cellOf(r: Row): string {
  return `${r.container}${r.nested ? "+nested" : ""}`;
}

function tally(xs: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[x] = (out[x] ?? 0) + 1;
  return out;
}

describe("IR ⇄ language let-type agreement census", () => {
  let census: Awaited<ReturnType<typeof runCensus>>;
  beforeAll(async () => {
    census = await runCensus();
    const out = process.env.LOOM_CENSUS_REPORT;
    if (out) fs.writeFileSync(out, JSON.stringify(census, null, 1));
  }, 600_000);

  it("reaches the corpus (vacuum guard)", () => {
    const joined = census.rows.filter((r) => r.klass);
    expect(census.files, "tracked .ddd population").toBeGreaterThan(MIN_FILES);
    expect(census.parsed, "files that parsed").toBeGreaterThan(MIN_FILES);
    expect(census.lowerFail, "files whose lowering threw").toEqual([]);
    expect(joined.length, "joined let rows — a broken walker or key joins nothing").toBeGreaterThan(
      MIN_JOINED,
    );
    expect(
      joined.filter((r) => r.klass === "agree").length,
      "agreeing rows — a key normalisation that broke would zero this",
    ).toBeGreaterThan(MIN_AGREE);
  });

  it("every let joins, or sits in a named unjoined category", () => {
    const live = tally(census.rows.filter((r) => r.unjoined).map((r) => r.unjoined as string));
    const unexplained = census.rows
      .filter((r) => r.unjoined === "UNEXPLAINED")
      .map((r) => `${r.file} ${r.key}`);
    expect(
      unexplained,
      "A let exists in only one layer for no reason the census knows. Either the join key " +
        "broke (fix the census) or a new lowering/AST shape appeared (name its category):",
    ).toEqual([]);
    expect(
      live,
      "Unjoined-row counts moved — shrink-only, and a drop must lower UNJOINED_BASELINE:",
    ).toEqual(UNJOINED_BASELINE);
  });

  it("no NEW type disagreement between the IR and the language layer", () => {
    const live = tally(
      census.rows
        .filter(
          (r) =>
            r.klass &&
            r.klass !== "agree" &&
            !(r.container !== undefined && r.container in TOTAL_GAP_CONTAINERS),
        )
        .map((r) => `${cellOf(r)}/${r.klass}`),
    );
    const grown = Object.entries(live)
      .filter(([k, n]) => n > (DISAGREEMENT_BASELINE[k] ?? 0))
      .map(([k, n]) => `${k}: baseline ${DISAGREEMENT_BASELINE[k] ?? 0} → ${n}`);
    expect(
      grown,
      "New IR ⇄ language let-type disagreement(s). Run with LOOM_CENSUS_REPORT=<path> to see " +
        "the rows. Fix the layer that is wrong; raise a baseline row only for a new corpus " +
        "let of an already-baselined class:",
    ).toEqual([]);
  });

  it("total-gap containers stay total: none agrees, and no row drifts class", () => {
    for (const [container, gap] of Object.entries(TOTAL_GAP_CONTAINERS)) {
      const rows = census.rows.filter((r) => r.klass && r.container === container);
      expect(
        rows.length,
        `${container}: vacuum floor — the census found too few lets`,
      ).toBeGreaterThan(gap.minRows);
      const agreeing = rows.filter((r) => r.klass === "agree").map((r) => `${r.file} ${r.key}`);
      expect(
        agreeing,
        `${container} is pinned as a TOTAL gap (${gap.why}) but some lets now AGREE — the gap is ` +
          "being drained. Move it out of TOTAL_GAP_CONTAINERS into exact DISAGREEMENT_BASELINE rows:",
      ).toEqual([]);
      const drifted = rows
        .filter((r) => r.klass !== "agree" && !gap.classes.includes(r.klass as string))
        .map((r) => `${r.file} ${r.key}: ${r.klass}`);
      expect(
        drifted,
        `${container}: a let moved into a class the total gap does not cover — a NEW disagreement:`,
      ).toEqual([]);
    }
  });

  it("anti-slack: a drained disagreement lowers its baseline row in the same change", () => {
    const live = tally(
      census.rows
        .filter(
          (r) =>
            r.klass &&
            r.klass !== "agree" &&
            !(r.container !== undefined && r.container in TOTAL_GAP_CONTAINERS),
        )
        .map((r) => `${cellOf(r)}/${r.klass}`),
    );
    const stale = Object.entries(DISAGREEMENT_BASELINE)
      .filter(([k, n]) => (live[k] ?? 0) < n)
      .map(([k, n]) => `${k}: baseline ${n}, actual ${live[k] ?? 0} — lower it`);
    expect(
      stale,
      "A disagreement count fell without lowering its DISAGREEMENT_BASELINE row:",
    ).toEqual([]);
  });
});
