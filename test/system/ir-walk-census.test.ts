import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Wave 2 packet 2.3 — "no hand-rolled IR walks" (docs/new-plan/improvement-
// waves-2026-09.md §Wave 2 item 2.3).
//
// The defect class this closes (#2720, #2705, M-T6.50): a collector or
// emitter hand-rolls a `switch (e.kind)` / `switch (s.kind)` over
// `ExprIR`/`StmtIR`/`WorkflowStmtIR` (or the equivalent `if (x.kind ===
// "a") … else if (x.kind === "b") …` chain), the union grows a new member,
// and the switch silently falls through its `default` — a `currentUser`
// hidden in a `match` arm never threads the auth param, a `repo-read` nested
// in a for-each body never derives a read-port, an emitter drops a whole
// construct with no compiler signal.  `src/ir/util/walk.ts` is the shared,
// `never`-checked shallow walker every TRAVERSAL should ride instead of
// re-deriving its own child enumeration; but a KIND-SPECIFIC DISPATCH (an
// emitter choosing what to render per kind) is not itself wrong — it only
// needs to prove, at compile time, that it does not silently drop a kind it
// doesn't recognise.
//
// THE DETECTOR (documented, per the packet brief, since this is a judgment
// call). Two shapes, both over a receiver whose static type is exactly
// (or includes) `ExprIR` / `StmtIR` / `WorkflowStmtIR` — verified with the
// real TypeScript checker, not a variable-name guess, so a switch over an
// unrelated `.kind` field (`TypeIR.kind`, `AuthzFilterKind`, `PageLayoutIR`,
// …) reusing a common receiver name (`e`, `s`, `node`, …) is never counted:
//
//   1. `switch (<recv>.kind) { … }`
//   2. an `if (<recv>.kind === "a") { … } else if (<recv>.kind === "b") …`
//      chain (constant-string comparisons, `||`-joined conditions included)
//      that names >= 3 DISTINCT kind literals on the same receiver — three
//      is the line because two arms reads as an ordinary two-way branch, not
//      a hand-rolled dispatch that will silently miss a fourth kind.
//
// EXHAUSTIVE means the site provably cannot compile once a new union member
// appears without either handling it or being touched: a `default` clause
// (switch) or terminal, condition-less `else` (if-chain) that assigns the
// receiver to a `: never`-typed binding, or calls a function whose name
// contains "assertNever" or "unreachable" — the exact idiom `walk.ts`
// already uses (`const _exhaustive: never = e; void _exhaustive;`), or the
// literal `satisfies Record<Kind, …>` table shape (a switch REPLACED by a
// table dispatch is, by construction, no longer a switch this census can
// even see — so a migration to that shape drops out of the census on its
// own; nothing further to check here).
//
// A site that is not exhaustive is either FIXED (migrated onto
// `walk.ts`'s `walk*Deep` helpers when its intent is "visit every reachable
// sub-node", or given a `never`-checked default when its intent is a closed,
// kind-specific dispatch) or WAIVED below with a specific, honest reason.
// Waivers RATCHET (CLAUDE.md Conventions), on THREE axes: a waiver whose site
// no longer exists, whose site has since become exhaustive, or whose REASON has
// expired fails one of the tests below — so neither a stale entry nor a
// permanent "we'll get to it" can silently outlive the code it excuses.  The
// third axis is wave CR1 packet CR1-d's; see the note above `MAX_DEFERRAL_DAYS`.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const TARGET_UNIONS = ["ExprIR", "StmtIR", "WorkflowStmtIR"] as const;
type TargetUnion = (typeof TARGET_UNIONS)[number];

/** The four sanctioned dispatchers (own the ONE 17/11/10-arm switch each, by
 *  design) plus the lowerers (`src/ir/lower/**`, which build IR — not walk
 *  it — and are exempted by the packet brief). */
const SANCTIONED_FILES = new Set<string>([
  "src/ir/util/walk.ts",
  "src/generator/_expr/target.ts",
  "src/generator/_stmt/target.ts",
  "src/generator/_workflow/stmt-target.ts",
]);

function isSanctioned(rel: string): boolean {
  if (SANCTIONED_FILES.has(rel)) return true;
  if (rel.startsWith("src/ir/lower/")) return true;
  return false;
}

interface Site {
  /** Stable-ish key: `<relFile>#<enclosingName>[$N]` — survives line churn
   *  elsewhere in the file, unlike a `file:line` waiver key. */
  id: string;
  file: string;
  line: number;
  union: TargetUnion;
  form: "switch" | "if-chain";
  exhaustive: boolean;
}

function typeNameMatches(checker: ts.TypeChecker, t: ts.Type): TargetUnion | null {
  const str = checker.typeToString(t, undefined, ts.TypeFormatFlags.None);
  for (const name of TARGET_UNIONS) {
    if (new RegExp(`\\b${name}\\b`).test(str)) return name;
  }
  return null;
}

/** Nearest enclosing named function-ish construct, walking up the parent
 *  chain — used only to build a readable, edit-stable waiver key. */
function enclosingName(node: ts.Node): string {
  let cur: ts.Node | undefined = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) && cur.name) return cur.name.text;
    if (ts.isMethodDeclaration(cur) && ts.isIdentifier(cur.name)) return cur.name.text;
    if (
      ts.isVariableDeclaration(cur) &&
      ts.isIdentifier(cur.name) &&
      cur.initializer &&
      (ts.isArrowFunction(cur.initializer) || ts.isFunctionExpression(cur.initializer))
    ) {
      return cur.name.text;
    }
    cur = cur.parent;
  }
  return "<module>";
}

/** Does `stmts` (recursively) contain a `never`-typed exhaustiveness check —
 *  either `const _x: never = <recv>;` or a call to `assertNever(...)` /
 *  `unreachable(...)`? Also true for a call to one of the sanctioned shallow
 *  visitors (`walkExprChildren` / `walkStmtChildren` /
 *  `walkWorkflowStmtChildren`) in the `default:` arm — delegating an
 *  unhandled kind to that walker is exactly as safe as a literal
 *  `never`-check: a future kind fails to compile THERE instead of silently
 *  falling through here (e.g. `_stmt/leaves.ts`'s `collectLeaves`, which
 *  special-cases a few kinds and lets the sanctioned walker exhaustively
 *  cover the rest). */
function hasNeverCheck(node: ts.Node): boolean {
  let found = false;
  function visit(n: ts.Node) {
    if (found) return;
    if (
      ts.isVariableDeclaration(n) &&
      n.type &&
      ((ts.isTypeReferenceNode(n.type) && n.type.typeName.getText() === "never") ||
        n.type.kind === ts.SyntaxKind.NeverKeyword)
    ) {
      found = true;
      return;
    }
    if (
      ts.isCallExpression(n) &&
      /assertNever|unreachable|walkExprChildren|walkStmtChildren|walkWorkflowStmtChildren/.test(
        n.expression.getText(),
      )
    ) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  }
  visit(node);
  return found;
}

let cachedSites: Site[] | null = null;

/** Scan `src/**\/*.ts` with the real TypeScript checker (so a `.kind` switch
 *  on an unrelated discriminated union never counts) and return every
 *  offending switch / if-chain site outside the sanctioned homes. Computed
 *  once — a full-program typecheck of `src/` — and cached for the whole
 *  test file. */
function computeSites(): Site[] {
  if (cachedSites) return cachedSites;

  const configPath = path.join(repoRoot, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(configFile.config, ts.sys, repoRoot);
  const program = ts.createProgram({ rootNames: parsed.fileNames, options: parsed.options });
  const checker = program.getTypeChecker();

  const sites: Site[] = [];
  const idCounts = new Map<string, number>();
  function nextId(base: string): string {
    const n = (idCounts.get(base) ?? 0) + 1;
    idCounts.set(base, n);
    return n === 1 ? base : `${base}$${n}`;
  }

  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile) continue;
    const rel = path.relative(repoRoot, sf.fileName).replaceAll(path.sep, "/");
    if (!rel.startsWith("src/")) continue;
    if (isSanctioned(rel)) continue;

    function lineOf(node: ts.Node): number {
      return sf.getLineAndCharacterOfPosition(node.getStart()).line + 1;
    }

    function visit(node: ts.Node) {
      // --- Form 1: switch (<recv>.kind) { … } ---
      if (ts.isSwitchStatement(node)) {
        const expr = node.expression;
        if (ts.isPropertyAccessExpression(expr) && expr.name.text === "kind") {
          const union = typeNameMatches(checker, checker.getTypeAtLocation(expr.expression));
          if (union) {
            const defaultClause = node.caseBlock.clauses.find((c) => ts.isDefaultClause(c));
            const exhaustive = !!defaultClause && defaultClause.statements.some(hasNeverCheck);
            const base = `${rel}#${enclosingName(node)}`;
            sites.push({
              id: nextId(base),
              file: rel,
              line: lineOf(node),
              union,
              form: "switch",
              exhaustive,
            });
          }
        }
      }

      // --- Form 2: if (<recv>.kind === "a") … else if (<recv>.kind === "b") … ---
      // Only inspect chain HEADS (not an else-if link already covered by its
      // parent's walk) so a 4-armed chain reports once, not four times.
      if (ts.isIfStatement(node)) {
        const isElseIfContinuation =
          !!node.parent && ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
        if (!isElseIfContinuation) {
          type Hit = { recv: string; lit: string; recvNode: ts.Node };
          function condHits(expr: ts.Expression, out: Hit[]) {
            if (ts.isBinaryExpression(expr)) {
              if (expr.operatorToken.kind === ts.SyntaxKind.BarBarToken) {
                condHits(expr.left, out);
                condHits(expr.right, out);
                return;
              }
              if (
                (expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ||
                  expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsToken) &&
                ts.isPropertyAccessExpression(expr.left) &&
                expr.left.name.text === "kind" &&
                ts.isStringLiteralLike(expr.right)
              ) {
                out.push({
                  recv: expr.left.expression.getText(),
                  lit: expr.right.text,
                  recvNode: expr.left.expression,
                });
              }
            }
          }

          // Walk the if/else-if chain, collecting every kind-literal
          // comparison and, separately, whether the chain ends in a bare
          // `else { … }` (no further condition) that carries a never-check.
          let cursor: ts.IfStatement = node;
          const hits: Hit[] = [];
          let terminalElseExhaustive = false;
          let sawTerminalElse = false;
          for (;;) {
            condHits(cursor.expression, hits);
            const nxt = cursor.elseStatement;
            if (!nxt) break;
            if (ts.isIfStatement(nxt)) {
              cursor = nxt;
              continue;
            }
            sawTerminalElse = true;
            terminalElseExhaustive = hasNeverCheck(nxt);
            break;
          }

          const byRecv = new Map<string, { lits: Set<string>; recvNode: ts.Node }>();
          for (const h of hits) {
            if (!byRecv.has(h.recv)) byRecv.set(h.recv, { lits: new Set(), recvNode: h.recvNode });
            byRecv.get(h.recv)?.lits.add(h.lit);
          }
          for (const [, info] of byRecv) {
            if (info.lits.size < 3) continue;
            const union = typeNameMatches(checker, checker.getTypeAtLocation(info.recvNode));
            if (!union) continue;
            const base = `${rel}#${enclosingName(node)}`;
            sites.push({
              id: nextId(base),
              file: rel,
              line: lineOf(node),
              union,
              form: "if-chain",
              exhaustive: sawTerminalElse && terminalElseExhaustive,
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    }
    visit(sf);
  }

  cachedSites = sites;
  return sites;
}

/** A waiver's claim about the site it excuses.
 *
 *  `standing`  — a rationale with no shelf life.
 *  `deferred`  — parked work: an IOU, and therefore dated.  `blockedBy` names a
 *                row in {@link LIVE_FENCES} when the parking is somebody else's
 *                tree claim rather than time pressure.
 *
 *  See the long note below for why both the date and the fence are evaluated
 *  from this file alone. */
type Waiver = { standing: string } | { deferred: string; reviewUntil: string; blockedBy?: string };

// ---------------------------------------------------------------------------
// THE WAIVER SHAPE — and why a waiver can now EXPIRE.
//
// Wave CR1 packet CR1-d (docs/audits/code-review-2026-09-13.md row P0-1).  The
// register below carried 23 entries whose stated reason was a PROCESS FENCE
// that had already lifted: twelve said "in-flight fence — PR #2736/#2729/#2742
// owns this file this wave", and eleven deferred to "the 2.6 hotspot-split".
// All four had merged.  The ratchet could not see it: its two assertions are
// that a waived site still EXISTS and is still NON-EXHAUSTIVE, and both stayed
// true — so a deferral whose reason had a shelf life became permanent, silently.
//
// The fix is to give the ratchet the input it lacked.  A waiver is no longer a
// bare string; it declares WHICH KIND of claim it is making:
//
//   { standing: "<reason>" }
//       A rationale that does not expire — the site is correct as it stands and
//       no scheduled event is expected to change that.  A throwing dispatcher,
//       a coded give-up, a narrow guard already riding a sanctioned walker.
//
//   { deferred: "<reason>", reviewUntil: "YYYY-MM-DD", blockedBy?: "#NNNN" }
//       PARKED WORK.  The site is a known migration candidate that this or an
//       earlier packet did not reach.  It must name the date by which someone
//       re-reads it, and may name the fence it is waiting on.
//
// Three expiry rules, all evaluated OFFLINE and DETERMINISTICALLY from this
// file plus the clock — no network, no `git log`, no doc parsing:
//
//   E1  `reviewUntil` in the past          → FAIL.  The deferral outlived its
//                                            own stated horizon.
//   E2  `reviewUntil` more than MAX_DEFERRAL_DAYS out → FAIL, immediately and
//                                            forever.  This closes the obvious
//                                            escape ("reviewUntil: 2099-01-01"):
//                                            a date that far out never becomes
//                                            valid, so it cannot be used to
//                                            silence the rule.
//   E3  `blockedBy: "#NNNN"` not listed in LIVE_FENCES → FAIL.  Lifting a fence
//                                            is a ONE-LINE deletion from that
//                                            map, and every waiver leaning on it
//                                            then fails at once.
//
// Why not resolve `blockedBy` against the real merge state of the PR?  Because
// a test cannot call GitHub, and it cannot read git history either: CI checks
// out at `actions/checkout`'s default `fetch-depth: 1`, so `git log --grep
// "Merge pull request #2736"` finds nothing on a runner even when the PR merged
// months ago.  That mechanism would fail OPEN in exactly the place it has to
// hold — which is the failure mode this whole entry exists to remove.  A fence
// register the test OWNS is the offline, deterministic substitute: it is data,
// not history, it is identical on a runner and on a laptop, and it makes
// lifting the fence a deliberate act with an automatic cascade.
//
// E1 is the backstop for the fence nobody remembers to lift.
// ---------------------------------------------------------------------------

/** A deferral may not be parked further out than this.  Six months: long
 *  enough that a wave's follow-up drain is not artificially rushed, short
 *  enough that "we'll get to it" cannot quietly mean "never". */
const MAX_DEFERRAL_DAYS = 180;

/**
 * The fences a `blockedBy` waiver may name — PRs/packets that own a tree this
 * census flags and must not be edited around.
 *
 * ADD a row when you fence a file; DELETE the row the moment the fence lifts
 * (the PR merges, the packet folds).  Deleting it fails every waiver that
 * leaned on it, which is the point: the drain those waivers deferred becomes
 * due the same day the reason for deferring it stops being true.
 *
 * Empty is the healthy state.  It is empty right now because CR1-d drained the
 * twelve `#2736`/`#2729`/`#2742` entries that were fenced when they were
 * written and are not fenced any more.
 */
const LIVE_FENCES: Record<string, string> = {};

// ---------------------------------------------------------------------------
// Shared reasons.  A `standing` reason is a rationale; a `deferred` one is an
// IOU, and carries a date.
// ---------------------------------------------------------------------------

/** A closed, kind-specific PREDICATE or CLASSIFIER: every kind the switch does
 *  not explicitly list falls through to a deliberate, safe, generic value
 *  (`false` / `undefined` / `null` / `[]` / the neutral branch already
 *  documented at the call site) — not a traversal, and nothing is silently
 *  dropped from emitted OUTPUT the way the M-T6.50 class drops it (a narrower
 *  classification is the worst case, never a missing emission).
 *
 *  DEFERRED, not standing: these were classified by their `default`-arm SHAPE,
 *  not re-read per kind against the current `ExprIR`/`StmtIR`/`WorkflowStmtIR`
 *  vocabulary.  The shape argument bounds the blast radius; it does not prove
 *  any individual site still classifies correctly.  The drain re-reads each and
 *  either migrates it onto `walk.ts` or gives it an explicit `never`-check. */
const CLOSED_PREDICATE = {
  deferred:
    "closed, kind-specific predicate/classifier — every unhandled kind falls through to a safe, generic default; not a traversal, nothing silently drops from emitted output. Classified by default-arm shape, NOT re-verified per kind; the drain re-reads each site",
  reviewUntil: "2026-12-31",
} as const;

/** A closed, kind-specific EMISSION dispatcher whose `default` arm THROWS for
 *  any kind outside its declared vocabulary — a LOUD failure (a crash on
 *  generation, immediately visible), not the SILENT drop the M-T6.50 class
 *  describes.  Whether its declared vocabulary is still complete against the
 *  current kind list is a real question, but it is emission-mode /
 *  per-emitter case-completeness scope (parity work), not this census's
 *  silent-traversal-gap scope.
 *
 *  STANDING.  The rationale does not have a shelf life — nothing scheduled is
 *  going to make a throwing default stop being loud.  Note that a site in this
 *  category is still IMPROVABLE: enumerating the refused kinds and closing with
 *  a `never` turns a runtime crash into a compile error, which is what CR1-d
 *  did to four of them (they left the register entirely).  The waiver says the
 *  site is SAFE, not that it is finished. */
const THROWING_DISPATCHER = {
  standing:
    "closed emission dispatcher whose default arm THROWS for an unhandled kind (loud failure, not the silent-drop class this census targets); case-completeness is emission-mode/parity scope, not this census's",
} as const;

/** A shallow, ONE-LEVEL child-list builder (an `exprChildren`-shaped function)
 *  feeding a caller's own recursion — structurally the same concept as
 *  `walk.ts`'s `walkExprChildren`, and a genuine migration candidate.
 *
 *  DEFERRED.  CR1-d drained the hono twin of exactly this shape and it was
 *  carrying a real defect (see the note on `serviceReadPorts` in
 *  `platform/hono/v4/workflow-builder.ts`): the hand-rolled child list had no
 *  arm for `match` / `list` / `convert` / `duration` / `i18nFormat` /
 *  `authz-filter` / a block-bodied lambda's statements, so a domain-service
 *  call in any of those slots was invisible to the scan.  Treat the remaining
 *  four as suspects, not as safe. */
const SHALLOW_CHILD_BUILDER = {
  deferred:
    "one-level child-list builder (walkExprChildren-shaped) feeding the caller's own recursion — a walk.ts migration candidate. The hono twin of this exact shape was drained in CR1-d and WAS carrying a live defect (no `match`/`list`/lambda-block arm), so these are suspects",
  reviewUntil: "2026-12-31",
} as const;

/** A hand-rolled recursive traversal (`walk`/`visit`/collector-shaped)
 *  identified as a genuine migration candidate but not reached. */
const TRAVERSAL_TIME_BOXED = {
  deferred:
    "hand-rolled traversal identified as a walk.ts migration candidate, not yet migrated — the highest-risk category in this register (it is the #2720/#2705/M-T6.50 shape itself). Drain before the two above it",
  reviewUntil: "2026-12-31",
} as const;

/** Already rides a sanctioned walker (`walkWorkflowStmtChildren` /
 *  `walkExprDeep`) for the RECURSION step, with its own narrow, local per-kind
 *  logic layered on top — the census's if-chain detector still flags the local
 *  `if`/`||` guard itself (a narrow membership test, not a full dispatch),
 *  which a terminal `never`-checked `else` does not fit.  STANDING: the site is
 *  already in the shape this convention asks for. */
const DELEGATES_TO_SANCTIONED_WALKER = {
  standing:
    "already rides walkWorkflowStmtChildren/walkExprDeep for recursion; the flagged if/`||` guard is a narrow kind-membership test layered on top, not a dispatch needing full-kind coverage",
} as const;

/** The eleven sites packet 2.3 deferred to "the 2.6 hotspot-split", which
 *  landed as #2778 on 2026-09-03.  The fence is GONE — the split was a purely
 *  mechanical relocation and these are the same offenders at new addresses —
 *  so the reason is restated as what it actually is: an unfinished `walk.ts`
 *  migration, with a date.
 *
 *  CR1-d could not drain them: every remaining one lives under `src/ir/**`,
 *  which is packet 2f's tree fence on the live #2933 (Wave C2 batch 2).  They
 *  are handed to CR1-e.  This is NOT a `blockedBy` entry — #2933 fences the
 *  FILES, and CR1-e will drain them from inside that fence rather than waiting
 *  for it to lift. */
const HOTSPOT_SPLIT_RESIDUE = {
  deferred:
    "flagged by packet 2.3 as a genuine walk.ts migration candidate and deferred to the 2.6 hotspot-split (#2778, merged 2026-09-03) purely so the mechanical file move could land first. The split HAS landed; the migration is the outstanding work. Handed to wave CR1 packet CR1-e — CR1-d could not touch these (src/ir/** is packet 2f's fence on #2933)",
  reviewUntil: "2026-12-31",
} as const;

// ---------------------------------------------------------------------------
// Waivers — every entry names the exact site (file + enclosing function) and a
// reason.  Ratcheted by the tests below: a waiver whose site is gone, whose
// site has since become exhaustive, or whose DEFERRAL HAS EXPIRED fails, and
// must be drained or honestly re-dated.
// ---------------------------------------------------------------------------

const WAIVERS: Record<string, Waiver> = {
  // --- 2.6 hotspot-split residue (see HOTSPOT_SPLIT_RESIDUE) --------------
  "src/ir/validate/checks/datasource-checks.ts#docExprUnsupported": HOTSPOT_SPLIT_RESIDUE,
  "src/ir/validate/checks/datasource-checks.ts#docFunctionUnsupported": HOTSPOT_SPLIT_RESIDUE,
  "src/ir/validate/checks/datasource-checks.ts#docStmtUnsupported": HOTSPOT_SPLIT_RESIDUE,
  "src/ir/validate/checks/backend-syntax-checks.ts#eachStmtExpr": HOTSPOT_SPLIT_RESIDUE,
  "src/ir/validate/checks/ui-action-body-checks.ts#checkBody": HOTSPOT_SPLIT_RESIDUE,
  "src/ir/validate/checks/ui-page-structure-checks.ts#directlyRenderedRefs": HOTSPOT_SPLIT_RESIDUE,
  "src/ir/validate/checks/ui-page-structure-checks.ts#namesReadByBody": HOTSPOT_SPLIT_RESIDUE,
  "src/ir/validate/checks/ui-action-body-checks.ts#toastMessageProblem": HOTSPOT_SPLIT_RESIDUE,
  "src/ir/validate/checks/ui-action-body-checks.ts#visitExpr": HOTSPOT_SPLIT_RESIDUE,
  "src/ir/validate/checks/ui-action-body-checks.ts#visitStmt": HOTSPOT_SPLIT_RESIDUE,

  // NOTE — the twelve `in-flight fence` waivers that stood here (#2736 on
  // `zod-refine.ts`, #2729 on the two walker cores, #2742 on the three hono
  // v4 builders) are GONE, together with `mikroorm-filter.ts#filterValue`'s
  // hotspot-split entry.  All four fences had lifted; CR1-d drained the
  // thirteen sites they covered — four migrated onto `walk.ts`, nine given an
  // explicit `never`-check.  One of them (`workflow-builder.ts#exprChildren`
  // feeding `serviceReadPorts`) was carrying a live defect: a `reading`-tier
  // domain-service call inside a `match` arm derived no read port, and the
  // emitted Hono workflow handler named an undeclared repository binding.

  // --- already delegates to a sanctioned walker for recursion --------------
  "src/generator/java/explicit-handlers-emit.ts#reposUsed": DELEGATES_TO_SANCTIONED_WALKER,
  "src/generator/python/explicit-handlers-emit.ts#walk": DELEGATES_TO_SANCTIONED_WALKER,
  "src/generator/python/workflows-builder.ts#visit": DELEGATES_TO_SANCTIONED_WALKER,

  // --- closed predicates/classifiers (safe generic default) ----------------
  "src/generator/_expr/authz-filter-inapp.ts#desugarAuthzFilterInApp": CLOSED_PREDICATE,
  "src/generator/_expr/authz-filter-inapp.ts#hasAuthzFilter": CLOSED_PREDICATE,
  "src/generator/_walker/primitives/forms.ts#defaultUsesThis": CLOSED_PREDICATE,
  "src/generator/dotnet/criteria-emit.ts#anyRef": CLOSED_PREDICATE,
  "src/generator/dotnet/emit/efcore.ts#collectColumnRefs": CLOSED_PREDICATE,
  "src/generator/dotnet/emit/efcore.ts#exprRefsCurrentUser": CLOSED_PREDICATE,
  "src/generator/dotnet/render-expr.ts#addCsExprUsing": CLOSED_PREDICATE,
  "src/generator/elixir/realtime-liveview.ts#exprUsesBind": CLOSED_PREDICATE,
  "src/generator/elixir/render-expr.ts#isDecimalOperand": CLOSED_PREDICATE,
  "src/generator/elixir/vanilla/changeset-invariant-emit.ts#structEvaluable": CLOSED_PREDICATE,
  "src/generator/elixir/vanilla/provenance-emit.ts#leavesResolveToColumns": CLOSED_PREDICATE,
  "src/generator/elixir/vanilla/provenance-emit.ts#paramLeafNames": CLOSED_PREDICATE,
  "src/generator/elixir/vanilla/wire-serialize.ts#derivedRenderable": CLOSED_PREDICATE,
  "src/generator/elixir/vanilla/workflow-eventsourced-emit.ts#bodyUsesState": CLOSED_PREDICATE,
  "src/generator/feliz/realtime.ts#exprReadsBinding": CLOSED_PREDICATE,
  // Same shape as the line above, and deliberately NOT `never`-checked: its
  // `default: false` mirrors `renderFsToastMessage`'s supported vocabulary
  // (literal / ref / member / paren / binary) exactly, and every kind outside
  // that set THROWS at render time rather than reaching here.  An exhaustive
  // arm would assert coverage this predicate does not want.
  "src/generator/feliz/realtime.ts#reads": CLOSED_PREDICATE,
  "src/generator/flutter/realtime.ts#exprReadsBinding": CLOSED_PREDICATE,
  "src/generator/java/render-expr.ts#addJavaExprImport": CLOSED_PREDICATE,
  "src/generator/python/find-predicate.ts#isColumnRooted": CLOSED_PREDICATE,
  "src/generator/python/find-predicate.ts#lower": CLOSED_PREDICATE,
  "src/generator/python/render-expr.ts#addPyExprImport": CLOSED_PREDICATE,
  "src/generator/react/pages-emitter.ts#exprUsesCodeBlock": CLOSED_PREDICATE,
  "src/generator/react/pages-emitter.ts#stmtUsesCodeBlock": CLOSED_PREDICATE,
  "src/generator/typescript/emit/schema.ts#collectColumnRefs": CLOSED_PREDICATE,
  "src/generator/typescript/render-stmt.ts#markableExprsOf": CLOSED_PREDICATE,
  "src/ir/util/domain-service-tier.ts#classifyDomainServiceTier": CLOSED_PREDICATE,
  "src/ir/util/sql-renderable-expr.ts#sqlRenderableExpr": CLOSED_PREDICATE,
  "src/ir/util/temporal.ts#isDatetimeTypedIR": CLOSED_PREDICATE,
  "src/ir/validate/checks/api-checks.ts#aggregatesTouched": CLOSED_PREDICATE,
  "src/ir/validate/checks/api-checks.ts#handlerMutates": CLOSED_PREDICATE,
  "src/ir/validate/checks/domain-service-checks.ts#checkOperationBody": CLOSED_PREDICATE,
  "src/ir/validate/checks/migration-checks.ts#sqlExprFamily": CLOSED_PREDICATE,
  "src/ir/validate/checks/query-checks.ts#describeSeedValue": CLOSED_PREDICATE,
  "src/ir/validate/checks/shared.ts#firstUnknownColumnRef": CLOSED_PREDICATE,
  "src/ir/validate/checks/structural-checks.ts#check": CLOSED_PREDICATE,
  "src/ir/validate/checks/structural-checks.ts#lifecycleGuardIllegalReads": CLOSED_PREDICATE,
  "src/ir/validate/checks/structural-checks.ts#validateEventSourcedDiscipline": CLOSED_PREDICATE,
  "src/ir/validate/checks/structural-checks.ts#validateEventSourcedDiscipline$2": CLOSED_PREDICATE,
  "src/ir/validate/checks/workflow-checks.ts#checkBranchOpCalls": CLOSED_PREDICATE,
  "src/ir/enrich/enrichments.ts#tailBindType": CLOSED_PREDICATE,
  "src/util/expr-body-type.ts#bodyTypeOf": CLOSED_PREDICATE,
  "src/util/expr-body-type.ts#provableStringType": CLOSED_PREDICATE,

  // --- closed emission dispatchers (default THROWS — loud, not silent) -----
  "src/generator/_frontend/default-seed.ts#renderDefaultSeed": THROWING_DISPATCHER,
  "src/generator/_frontend/gate-expr.ts#renderGateExpr": THROWING_DISPATCHER,
  "src/generator/_frontend/realtime.ts#renderMessageExpr": THROWING_DISPATCHER,
  "src/generator/dotnet/emit/dapper.ts#whereToSql": THROWING_DISPATCHER,
  "src/generator/elixir/dispatch-emit.ts#renderStmt": THROWING_DISPATCHER,
  "src/generator/elixir/domain-service-emit.ts#renderStatement": THROWING_DISPATCHER,
  "src/generator/elixir/domain-service-emit.ts#substituteRefs": THROWING_DISPATCHER,
  "src/generator/elixir/realtime-liveview.ts#go": THROWING_DISPATCHER,
  "src/generator/elixir/store-emit.ts#renderStoreExpr": THROWING_DISPATCHER,
  "src/generator/elixir/store-emit.ts#renderStoreStmt": THROWING_DISPATCHER,
  "src/generator/elixir/vanilla/eventsourced-emit.ts#renderCommandRunner": THROWING_DISPATCHER,
  "src/generator/elixir/vanilla/fold-stmt-emit.ts#renderFoldStatement": THROWING_DISPATCHER,
  "src/generator/elixir/vanilla/function-emit.ts#renderPureBlock": THROWING_DISPATCHER,
  "src/generator/elixir/vanilla/operation-returns-emit.ts#renderReturningStmt": THROWING_DISPATCHER,
  "src/generator/elixir/vanilla/tests-emit.ts#vtExpr": THROWING_DISPATCHER,
  "src/generator/elixir/vanilla/workflow-eventsourced-emit.ts#renderEsWorkflowHandler":
    THROWING_DISPATCHER,
  "src/generator/elixir/vanilla/workflow-execution-emit.ts#lowerStatement": THROWING_DISPATCHER,
  "src/generator/elixir/vanilla/workflow-execution-emit.ts#renderBranch": THROWING_DISPATCHER,
  "src/generator/feliz/auth-gate.ts#renderFelizGate": THROWING_DISPATCHER,
  "src/generator/feliz/fs-expr.ts#renderFsExpr": THROWING_DISPATCHER,
  "src/generator/feliz/realtime.ts#renderFsToastMessage": THROWING_DISPATCHER,
  "src/generator/feliz/update-emit.ts#renderUpdateStmt": THROWING_DISPATCHER,
  "src/generator/flutter/auth-gate.ts#renderFlutterGate": THROWING_DISPATCHER,
  "src/generator/flutter/realtime.ts#renderDartToastMessage": THROWING_DISPATCHER,
  "src/generator/flutter/riverpod-emit.ts#renderNotifierStmt": THROWING_DISPATCHER,
  "src/generator/java/render-criteria.ts#bool": THROWING_DISPATCHER,
  "src/generator/java/render-jpql.ts#render": THROWING_DISPATCHER,
  "src/generator/java/render-sql-restriction.ts#renderSqlRestriction": THROWING_DISPATCHER,
  "src/generator/python/workflow-eventsourced-emit.ts#renderApplierStmt": THROWING_DISPATCHER,
  "src/generator/sql-pg-expr.ts#renderSqlScalarExpr": THROWING_DISPATCHER,
  "src/system/mermaid.ts#sequenceMessages": THROWING_DISPATCHER,
  "src/system/mermaid.ts#stepNode": THROWING_DISPATCHER,

  // --- shallow one-level child-list builders (walkExprChildren-shaped) -----
  "src/generator/feliz/wire.ts#exprChildren": SHALLOW_CHILD_BUILDER,
  "src/generator/flutter/forms-emit.ts#exprChildren": SHALLOW_CHILD_BUILDER,
  "src/generator/flutter/inputs-emit.ts#exprChildren": SHALLOW_CHILD_BUILDER,
  "src/generator/flutter/reads-emit.ts#exprChildren": SHALLOW_CHILD_BUILDER,

  // --- hand-rolled traversals identified but not migrated ------------------
  "src/generator/elixir/vanilla/explicit-handlers-emit.ts#collectRecordFieldsInStmt":
    TRAVERSAL_TIME_BOXED,
  "src/generator/elixir/vanilla/provenance-emit.ts#collectVanillaLeaves": TRAVERSAL_TIME_BOXED,
  "src/generator/elixir/vanilla/tests-emit.ts#childExprs": TRAVERSAL_TIME_BOXED,
  "src/generator/elixir/vanilla/workflow-execution-emit.ts#collectParamRefs": TRAVERSAL_TIME_BOXED,
  "src/generator/elixir/vanilla/workflow-execution-emit.ts#collectParamRefsInStmt":
    TRAVERSAL_TIME_BOXED,
  // `#collectWorkflowStmtParamRefs` waiver DELETED, and it is the census
  // earning its keep: the waived switch covered 13 of the 14 `WorkflowStmtIR`
  // kinds, with no `default`, and the missing one was `assign` — so a create
  // that assigned workflow state from a param (`orderId := order`) never
  // surfaced that param into the `run/1` destructure and the emitted Elixir
  // named an undefined variable.  Migrated onto `walkWorkflowStmtChildren`
  // (F58 / M-T6.62); the waiver goes with the fix, per the ratchet convention.
  "src/system/e2e-render.ts#visit": TRAVERSAL_TIME_BOXED,
  "src/system/e2e-render.ts#visit$2": TRAVERSAL_TIME_BOXED,
};

describe("IR walk census — no hand-rolled switch/if-chain over ExprIR/StmtIR/WorkflowStmtIR", () => {
  const sites = computeSites();

  it("finds a substantial surface, not an empty one", () => {
    // The blind-analysis guard every census in this repo carries (see
    // `expr-site-census.test.ts`): a broken detector reports zero sites,
    // which reads as "every switch is exhaustive" to anyone who checks this
    // test's colour instead of its count.
    expect(sites.length).toBeGreaterThan(80);
    expect(sites.filter((s) => s.form === "switch").length).toBeGreaterThan(70);
  });

  it("every offending site is exhaustive or waived", () => {
    const failures: string[] = [];
    for (const s of sites) {
      if (s.exhaustive) continue;
      if (Object.hasOwn(WAIVERS, s.id)) continue;
      failures.push(
        `${s.id} (${s.file}:${s.line}) — hand-rolled ${s.form} over ${s.union}.kind with no ` +
          `default:never / assertNever arm and no waiver. Either migrate onto ` +
          `src/ir/util/walk.ts's walk*Deep helpers (if the intent is "visit every ` +
          `reachable node") or add a never-checked default/else arm (if it is a ` +
          `closed, kind-specific dispatch), or waive it here with a reason.`,
      );
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("waivers ratchet — every entry still names a real, still-non-exhaustive site", () => {
    const byId = new Map(sites.map((s) => [s.id, s]));
    const stale: string[] = [];
    for (const id of Object.keys(WAIVERS)) {
      const s = byId.get(id);
      if (!s) {
        stale.push(`${id} — no such site found any more (delete the waiver)`);
        continue;
      }
      if (s.exhaustive) {
        stale.push(`${id} — site is now exhaustive (delete the waiver)`);
      }
    }
    expect(stale, stale.join("\n")).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // The THIRD failure mode (wave CR1 packet CR1-d).  The two assertions above
  // ratchet the SITE — gone, or fixed.  Neither can see a waiver whose REASON
  // has expired, which is how 23 entries fenced on four already-merged PRs sat
  // here untouched.  These two close that.
  // -------------------------------------------------------------------------

  it("deferred waivers expire — a parked drain cannot outlive its own review date", () => {
    const now = Date.now();
    const expired: string[] = [];
    for (const [id, w] of Object.entries(WAIVERS)) {
      if (!("deferred" in w)) continue;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(w.reviewUntil)) {
        expired.push(`${id} — reviewUntil "${w.reviewUntil}" is not a YYYY-MM-DD date`);
        continue;
      }
      const due = Date.parse(`${w.reviewUntil}T23:59:59Z`);
      if (Number.isNaN(due)) {
        expired.push(`${id} — reviewUntil "${w.reviewUntil}" is not a real date`);
        continue;
      }
      const daysOut = (due - now) / 86_400_000;
      if (daysOut < 0) {
        expired.push(
          `${id} — DEFERRAL EXPIRED on ${w.reviewUntil}. Its reason was an IOU, not a ` +
            `rationale: "${w.deferred}". Drain the site now (migrate it onto ` +
            `src/ir/util/walk.ts, or give it a never-checked default), or — if the ` +
            `deferral is still genuinely the right call — re-date it with a reason that ` +
            `says why it is still parked. Do not simply push the date.`,
        );
        continue;
      }
      if (daysOut > MAX_DEFERRAL_DAYS) {
        expired.push(
          `${id} — reviewUntil ${w.reviewUntil} is ${Math.round(daysOut)} days out, past the ` +
            `${MAX_DEFERRAL_DAYS}-day cap. A date this far ahead never becomes valid, so it ` +
            `cannot be used to silence the expiry rule. Pick a horizon someone will honour.`,
        );
      }
    }
    expect(expired, expired.join("\n\n")).toEqual([]);
  });

  it("a `blockedBy` waiver dies with its fence", () => {
    const orphaned: string[] = [];
    for (const [id, w] of Object.entries(WAIVERS)) {
      if (!("deferred" in w) || !w.blockedBy) continue;
      if (!Object.hasOwn(LIVE_FENCES, w.blockedBy)) {
        orphaned.push(
          `${id} — waived as blocked by ${w.blockedBy}, which is not in LIVE_FENCES. ` +
            `Either the fence lifted (then this waiver's reason is spent: drain the site) ` +
            `or the fence was never registered (then add it to LIVE_FENCES with what it owns).`,
        );
      }
    }
    expect(orphaned, orphaned.join("\n")).toEqual([]);
  });

  it("the fence register itself ratchets — no fence with nothing behind it", () => {
    // The mirror of the rule above.  A LIVE_FENCES row that no waiver cites is
    // a fence nobody is standing behind: it can only mislead the next agent
    // into thinking a tree is claimed when it is not.
    const cited = new Set(
      Object.values(WAIVERS).flatMap((w) => ("deferred" in w && w.blockedBy ? [w.blockedBy] : [])),
    );
    const unused = Object.keys(LIVE_FENCES).filter((pr) => !cited.has(pr));
    expect(unused, `LIVE_FENCES rows no waiver cites: ${unused.join(", ")}`).toEqual([]);
  });

  it("never counts a switch on an unrelated `.kind` field sharing a receiver name", () => {
    // `TypeIR.kind`, `AuthzFilterKind`, `PageLayoutIR.kind`, `LoadPlanIR.kind`
    // and friends all reuse the same common receiver names (`e`, `s`, `node`,
    // `t`) the naive `grep -E "switch \\((e|s|node)\\.kind\\)"` baseline this
    // packet started from cannot distinguish. The type-checked detector must
    // not attribute e.g. `switch (e.filter.kind)` (an `AuthzFilterKind`
    // discriminant nested inside an `authz-filter` ExprIR) to `ExprIR` itself.
    const falsePositive = sites.find(
      (s) => s.file === "src/generator/_expr/authz-filter-inapp.ts" && s.line === 1,
    );
    expect(falsePositive).toBeUndefined();
  });

  it("attributes a switch by its receiver's real type, not its variable name", () => {
    // `isDecimalOperand` switches on a param named `operand` — outside the
    // naive baseline's `(e|expr|s|stmt|node|st|ex)` name list, but a real
    // `ExprIR.kind` dispatch the census must still catch.
    const found = sites.find(
      (s) => s.file === "src/generator/elixir/render-expr.ts" && s.union === "ExprIR",
    );
    expect(found).toBeDefined();
  });
});
