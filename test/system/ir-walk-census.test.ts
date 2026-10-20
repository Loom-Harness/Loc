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

/** ===========================================================================
 *  CR1-f (wave CR1, audit row P0-2b) — the `THROWING_DISPATCHER` bucket, drained.
 *
 *  The bucket carried 32 entries behind one blanket `standing` reason: "closed
 *  emission dispatcher whose default arm THROWS for an unhandled kind (loud
 *  failure, not the silent-drop class this census targets)".  The audit's
 *  objection, acted on here: for a GENERATOR, "loud" means `ddd generate
 *  system` dies on a valid `.ddd` — this repo's own definition of a SILENT
 *  gap, as opposed to an HONEST gap (a `loom.*` diagnostic that refuses it at
 *  parse time with an explanation).  So each of the 32 was re-read against the
 *  CURRENT kind list from `walk.ts` (scripted, not eyeballed) and, where the
 *  vocabulary was short, probed with a real `.ddd` through the CLI.
 *
 *  What the drain found, and why the blanket reason had to go:
 *
 *    * 12 of the 32 DO NOT THROW AT ALL.  Five were total by case count with
 *      no `default` (now `never`-checked, waivers deleted); seven have a
 *      SILENT default — `return null` / `return e` / `return "nil"` /
 *      `return { value: "state" }` / `break` — i.e. they are the very
 *      silent-drop class the bucket claimed to exclude.  One was PROVEN so:
 *      `workflow-eventsourced-emit.ts#renderEsWorkflowHandler` drops a
 *      `repo-let` out of an event-sourced workflow's `on(...)` handler
 *      ENTIRELY (node emits `const o = await orders.getById(pr.order)`;
 *      elixir emits nothing, `0 error(s), 0 warning(s)`).
 *    * 2 were reachable crashes that are now HONEST REFUSALS, landed in this
 *      packet: the page `requires` gate (`loom.ui-gate-expr-unsupported`) and
 *      three leaves the queryable oracle admitted that no query renderer
 *      emits (`this` / `id` / a bare `duration`, now refused by
 *      `loom.find-where-not-queryable`).
 *    * 2 are real PARITY DEBT, handed to `parity-auditor` rather than built
 *      here — each measured against a backend that DOES emit the shape.
 *    * the rest are genuine assertions, and each now names the `loom.*` code
 *      that keeps a valid `.ddd` off its path, because "a validator probably
 *      catches it" is exactly the unverified reasoning this wave corrects.
 *
 *  A CITED GATE IS NOT A PROOF UNTIL ITS DEPTH IS CHECKED.  The first pass of
 *  this drain cited `loom.applier-emits` and friends for
 *  `fold-stmt-emit.ts#renderFoldStatement` and moved on.  Re-reading the gate
 *  (the shape CR1-e found five times in the sibling bucket) showed it iterated
 *  `ap.statements` TOP-LEVEL, so a nested `emit` sailed through — and that the
 *  Elixir `if` gate did not list applier bodies AT ALL, which made this arm's
 *  throw reachable from `apply(e) { if c { … } }` on a model `ddd parse` called
 *  clean.  Both are fixed in this packet, with top-level controls, because a
 *  waiver whose cited gate does not reach the dispatcher is not a waiver.  When
 *  resolving one of the remaining `deferred` rows: check that the gate you cite
 *  visits the same nesting the emitter does, not merely that it exists.
 *
 *  The per-site entries below replace the blanket constant, which is GONE: no
 *  waiver in this register uses `THROWING_DISPATCHER` any more.  Note which
 *  ones are `standing` and which are `deferred`: a site is only `standing`
 *  when a named `loom.*` gate makes it unreachable, per CR1-d's rule.
 *  ======================================================================== */

/** The `toast(<expr>)` message subset.  `checkToastMessages`
 *  (`ui-action-body-checks.ts`) mirrors these four `switch`es ARM FOR ARM —
 *  literal / the event binding / a member chain off it / paren / binary — and
 *  refuses everything else at phase ⑦ before any renderer runs.
 *
 *  STANDING: the gate and the switches are the same vocabulary by
 *  construction, and the gate's own comment says so; there is no scheduled
 *  event that makes this stop holding. */
/** The client-evaluable GATE SUBSET (`src/ir/util/ui-gate.ts`, audit D2) — landed
 *  on `main` while this wave was open, in the register's older bare-string shape.
 *  Both sites are closed CLASSIFIERS whose `default` arm is the CONSERVATIVE
 *  answer, not a fall-through: `firstNonUiGateNode` REJECTS an unrecognised kind
 *  (not client-evaluable until all six frontend gate renderers can render it, so
 *  rejecting is the safe default and a `never`-check would force every future
 *  kind to edit this file just to say "no"), and `printGateExpr` degrades to
 *  `<kind>` inside a diagnostic string. Neither traverses for emission, so the
 *  failure mode this census targets is structurally absent.
 *
 *  STANDING, and genuinely so — "reject an unknown kind" is not waiting on
 *  anything. */
const UI_GATE_CLOSED_SUBSET = {
  standing:
    "closed client-evaluable-gate classifier whose default arm is the conservative answer (reject / degrade-to-<kind>), not a silent fall-through; a new ExprIR kind is correctly refused until every frontend gate renderer can render it",
} as const;

const STANDING_TOAST_SUBSET = {
  standing:
    "unreachable — `loom.toast-message-unsupported` (src/ir/validate/checks/ui-action-body-checks.ts#toastMessageProblem) bounds the `toast(…)` message to exactly this switch's vocabulary, arm for arm, at phase ⑦",
} as const;

/** The page `requires` gate subset.  Minted in THIS packet after the crash was
 *  measured: `page Welcome { requires string(currentUser.role) == "admin" }`
 *  on an `auth: ui` svelte deployable printed `0 error(s), 0 warning(s)` and
 *  then died with `Error: UI gate: expression kind 'convert' is not supported
 *  in a UI gate`.
 *
 *  STANDING: the gate mirrors the three renderers arm for arm and is pinned by
 *  `test/ir/ui-page-gate-expr.test.ts`, whose controls also assert the
 *  in-subset shapes stay accepted on all six frontends. */
const STANDING_UI_GATE_SUBSET = {
  standing:
    "unreachable — `loom.ui-gate-expr-unsupported` (src/ir/validate/checks/ui-framework-checks.ts#pageGateProblem, CR1-f) bounds a page `requires` gate to exactly this switch's vocabulary at phase ⑦; before it, this arm was a measured codegen crash (test/ir/ui-page-gate-expr.test.ts)",
} as const;

/** The queryable sublanguage.  `firstNonQueryableNode`
 *  (`ir/validate/checks/shared.ts`) is exhaustive + `never`-checked and admits
 *  only: literal, ref (6 refKinds), paren, unary `!`, comparison/boolean
 *  binary (+ the `datetime ± duration` temporal form), `this.<col>` /
 *  `currentUser.<claim>` member, `contains` / queryable-intrinsic method-call,
 *  and `authz-filter`.  CR1-f closed the three leaves it used to admit that no
 *  query renderer emits — bare `this`, bare `id` and a standalone `duration`
 *  — each measured as a `QueryEmissionRefusal` crash on a `0 error(s)` model
 *  (test/ir/queryable-non-column-leaves.test.ts).
 *
 *  STANDING: the oracle is itself `never`-checked, so a new `ExprIR` kind
 *  cannot silently join the admitted set — it fails to compile there first. */
const STANDING_QUERYABLE_SUBSET = {
  standing:
    "unreachable — every predicate reaching here passes `firstNonQueryableNode` (src/ir/validate/checks/shared.ts), whose admitted set is exactly this switch's vocabulary; the three leaves it used to over-admit (`this`, `id`, a standalone `duration`) are refused by `loom.find-where-not-queryable` as of CR1-f, and the residue routes through `loom.query-emission-invalid` rather than a bare Error",
} as const;

/** A ui `action` / MVU-update body.  Three phase-⑦ gates between them refuse
 *  every statement kind these switches omit.
 *
 *  STANDING: each gate names its frameworks as a membership set, so a new
 *  frontend joins the list rather than slipping past. */
const STANDING_UI_BODY_VOCAB = {
  standing:
    "unreachable — `loom.ui-body-statement-kind` (return/precondition/requires on every non-LiveView frontend), `loom.if-stmt-page-body-unsupported` (`if` anywhere in a ui body, every frontend) and phase-③ scope resolution (`emit` has no aggregate to emit from in ui scope) refuse every kind this switch omits",
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
 *  four as suspects, not as safe.
 *
 *  CR1-e strengthened that: draining the 52 shape-classified waivers turned up
 *  SIX more of the same shape — five VALIDATOR gates that never entered an `if`
 *  branch, and one emitter that produced Elixir which does not compile.  The
 *  suspicion is now evidence. */
const SHALLOW_CHILD_BUILDER = {
  deferred:
    "one-level child-list builder (walkExprChildren-shaped) feeding the caller's own recursion — a walk.ts migration candidate. The hono twin of this exact shape was drained in CR1-d and WAS carrying a live defect (no `match`/`list`/lambda-block arm), and CR1-e found six more instances of the shape; these are suspects",
  reviewUntil: "2026-12-31",
} as const;

/** A hand-rolled recursive traversal (`walk`/`visit`/collector-shaped)
 *  identified as a genuine migration candidate but not reached.
 *
 *  With `CLOSED_PREDICATE` gone (CR1-e), this is the last bucket whose members
 *  are traversals BY THEIR OWN ADMISSION — and CR1-e's finding is that a
 *  traversal misfiled as a predicate is exactly where the defects were.  Drain
 *  this one next. */
const TRAVERSAL_TIME_BOXED = {
  deferred:
    "hand-rolled traversal identified as a walk.ts migration candidate, not yet migrated — the highest-risk category left in this register (it is the #2720/#2705/M-T6.50 shape itself, and CR1-e found six live instances of that shape hiding among the shape-classified predicates). Drain this bucket before SHALLOW_CHILD_BUILDER",
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

// ---------------------------------------------------------------------------
// Waivers — every entry names the exact site (file + enclosing function) and a
// reason.  Ratcheted by the tests below: a waiver whose site is gone, whose
// site has since become exhaustive, or whose DEFERRAL HAS EXPIRED fails, and
// must be drained or honestly re-dated.
// ---------------------------------------------------------------------------

const WAIVERS: Record<string, Waiver> = {
  // `main` EXTRACTED this helper (the `for` + `if-let` nested-body walk) out of
  // two inline copies while this wave was open, and one of those copies was the
  // site CR1-e drained. The DEFECT the drain existed for — a `repo-let` inside a
  // branch body not registering its binding — is therefore already fixed here,
  // by main's own extraction, and this PR takes main's version.
  //
  // What is left is exhaustiveness of a helper main owns: it is an if-chain plus
  // a large switch with no `never` arm. Reworking that inside this 190-file PR
  // is the wrong trade — it is someone else's fresh code and the edit is not
  // small. `deferred`, not `standing`, because it genuinely means NOT YET.
  "src/ir/validate/checks/workflow-checks.ts#checkNestedBodyOpCalls": {
    deferred:
      "main extracted this helper after this wave branched; the repo-let defect it " +
      "covers is already fixed here, only the never-check is outstanding",
    reviewUntil: "2026-11-28",
  },
  "src/ir/util/ui-gate.ts#firstNonUiGateNode": UI_GATE_CLOSED_SUBSET,
  "src/ir/util/ui-gate.ts#printGateExpr": UI_GATE_CLOSED_SUBSET,
  // NOTE — the two BULK deferral buckets that stood here are GONE.
  //
  //   * `CLOSED_PREDICATE` (42 entries) — sites waived because the SHAPE of
  //     their `default:` arm looked safe, with their own reason text admitting
  //     they were "classified by default-arm shape, NOT re-verified per kind".
  //   * `HOTSPOT_SPLIT_RESIDUE` (10 entries) — the `src/ir/validate/checks/**`
  //     sites CR1-d could not reach behind #2933's fence.
  //
  // Wave CR1 packet CR1-e (audit row P0-2a) diffed all 52 case sets against
  // `walk.ts`'s own kind enumeration and drained every one: 11 migrated onto
  // `walk.ts`, 40 given an explicit `never`-check, 1 re-waived below as
  // `standing`.  Seven were carrying a real hole — six VALIDATOR gates blind to
  // statements inside an `if` branch (event-sourcing discipline, domain-service
  // no-emit/no-mutation, the elixir op-call position gate, the vanilla-document
  // function gate, the page-body action gates) and one EMITTER
  // (`workflow-eventsourced-emit.ts#bodyUsesState`) whose false negative bound
  // the fold snapshot as `_state` while the rendered body still named `state`.
  //
  // The twelve `in-flight fence` waivers that stood here before them (#2736 on
  // `zod-refine.ts`, #2729 on the two walker cores, #2742 on the three hono
  // v4 builders) went in CR1-d, together with `mikroorm-filter.ts#filterValue`'s
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
  // Already rides `walkExprDeep`; the flagged three-arm chain is the per-node
  // NAME EXTRACTION layered on top ("which callable / member does this node
  // name?"), not a dispatch that has to cover every kind.  A node kind it does
  // not name contributes nothing to a set used only to SUPPRESS a warning
  // (`loom.scaffold-filter-param-dropped`), so the worst case is the warning
  // firing where the author had in fact bound the find — advisory, and in the
  // noisy direction.  STANDING: the site is already in the shape the
  // convention asks for.
  "src/ir/validate/checks/ui-page-structure-checks.ts#namesReadByBody":
    DELEGATES_TO_SANCTIONED_WALKER,

  // --- CR1-f: the former `THROWING_DISPATCHER` bucket, per-site ------------
  // 32 in, 27 out (+1 new, for this packet's own gate).  FIVE waivers DELETED, not rewritten — `mermaid.ts`'s two,
  // `domain-service-emit.ts#renderStatement`,
  // `operation-returns-emit.ts#renderReturningStmt` and
  // `workflow-execution-emit.ts#lowerStatement` were already total by case
  // count with no `default`, so they got the explicit `never`-check (the
  // emission is byte-identical) and the ratchet took their entries.

  // -- unreachable: `loom.toast-message-unsupported` bounds the message ------
  "src/generator/_frontend/realtime.ts#renderMessageExpr": STANDING_TOAST_SUBSET,
  "src/generator/elixir/realtime-liveview.ts#go": STANDING_TOAST_SUBSET,
  "src/generator/feliz/realtime.ts#renderFsToastMessage": STANDING_TOAST_SUBSET,
  "src/generator/flutter/realtime.ts#renderDartToastMessage": STANDING_TOAST_SUBSET,

  // -- unreachable: `loom.ui-gate-expr-unsupported` bounds the page gate -----
  // All three renderers are arm-for-arm identical (including the two INNER
  // throws — a non-currentUser/enum ref, and any method but `contains`), which
  // is why one target-agnostic phase-⑦ rule covers six frontends.
  "src/generator/_frontend/gate-expr.ts#renderGateExpr": STANDING_UI_GATE_SUBSET,
  "src/generator/feliz/auth-gate.ts#renderFelizGate": STANDING_UI_GATE_SUBSET,
  "src/generator/flutter/auth-gate.ts#renderFlutterGate": STANDING_UI_GATE_SUBSET,

  // -- unreachable: the queryable sublanguage (`firstNonQueryableNode`) ------
  "src/generator/dotnet/emit/dapper.ts#whereToSql": STANDING_QUERYABLE_SUBSET,
  "src/generator/java/render-jpql.ts#render": STANDING_QUERYABLE_SUBSET,
  // The Criteria renderer's caller (`java/emit/criteria.ts:37`) ALSO runs the
  // oracle itself and returns `null` rather than rendering, so this arm sits
  // behind the gate twice.
  "src/generator/java/render-criteria.ts#bool": STANDING_QUERYABLE_SUBSET,
  // A capability/context FILTER predicate — the same oracle plus
  // `loom.context-filter-no-principal`, which refuses the one shape the
  // `authz-filter` arm cannot render statically (a principal-referencing
  // `scope` filter).
  "src/generator/java/render-sql-restriction.ts#renderSqlRestriction": STANDING_QUERYABLE_SUBSET,
  // Migration backfill expressions, not find predicates: bounded by
  // `loom.migration-expr-unsupported` (migration-checks.ts) BEFORE phase ⑨
  // renders them, and the residue routes through `refuseOutOfVocabulary`, so
  // the throw carries `loom.query-emission-invalid` rather than a bare Error.
  "src/generator/sql-pg-expr.ts#renderSqlScalarExpr": {
    standing:
      "unreachable — `loom.migration-expr-unsupported` (src/ir/validate/checks/migration-checks.ts) bounds a backfill expression to the SQL-renderable subset at phase ⑦, and the default arm routes through `refuseOutOfVocabulary` so even a validator bypass surfaces `loom.query-emission-invalid`, not a bare Error",
  },

  // -- unreachable: the ui action / MVU-update statement vocabulary ----------
  "src/generator/feliz/update-emit.ts#renderUpdateStmt": STANDING_UI_BODY_VOCAB,
  // This site's own comment already cites the four gates per kind and was
  // re-checked against them; kept verbatim as the reason.
  "src/generator/flutter/riverpod-emit.ts#renderNotifierStmt": STANDING_UI_BODY_VOCAB,

  // -- unreachable: the aggregate applier / pure-function discipline ---------
  // CORRECTED AFTER A DEPTH CHECK.  The first pass cited the applier discipline
  // and stopped there; checking whether the gate reaches the same DEPTH as the
  // dispatcher (the CR1-e shape) found it did not, twice over — see the entry.
  "src/generator/elixir/vanilla/fold-stmt-emit.ts#renderFoldStatement": {
    standing:
      "unreachable: `validateApplierBodies` (src/ir/validate/checks/body-stmt-vocabulary.ts) holds every applier — aggregate AND workflow — to `APPLIER_STMT_KINDS` (assign / add / remove / let / if), walking branches deep; `emit` / a call / a guard keep their own `loom.applier-*` codes and everything else (`return`, a bare expression) is `loom.applier-stmt-invalid`.  The one kind left that this switch omits, `if`, is refused in every elixir-hosted applier by the Elixir `if` gate (kind `event-sourced`).  Measured per kind by test/system/body-statement-census.test.ts; the nested-branch controls are test/ir/applier-discipline-nested.test.ts",
  },
  // The throw is CAUGHT: `renderTest` rescues `UnsupportedTestShapeError` and
  // degrades the case to `@tag :skip`, so this is not a codegen abort at all.
  // (That the skip is invisible in a green `mix test` run is a real
  // verification gap — recorded in the hand-off, owned by CR1-h, not here.)
  "src/generator/elixir/vanilla/tests-emit.ts#vtExpr": {
    standing:
      "not a codegen abort at all — the typed `UnsupportedTestShapeError` this arm raises is CAUGHT by `renderTest` (same file, ~line 219) and degrades the case to `@tag :skip`; only a NON-`UnsupportedTestShapeError` propagates, which is the deliberate emitter-bug signal",
  },

  // -- MISFILED: the default arm does not throw ----------------------------
  // Best-effort by design and documented as such (`renderDefaultSeed` returns
  // null so the caller keeps its type-zero seed) — the ONE member of this
  // group whose silent default is correct.  It is still misfiled.
  "src/generator/_frontend/default-seed.ts#renderDefaultSeed": {
    standing:
      "MISFILED by the old bucket, but correct as it stands: `default: return null` is a documented BEST-EFFORT fallback (the caller keeps its type-zero seed), never a throw. Wrong bucket, right behaviour — shape-wise it is a CLOSED_PREDICATE (packet CR1-e's class)",
  },
  // An IR→IR substitution map, not an emitter: `default: return e` leaves a
  // `param` ref UNSUBSTITUTED inside a `list` / `match` / `convert` /
  // `i18nFormat` / `duration` / `lambda`, which emits Elixir naming an
  // undefined variable — the #2720/M-T6.50 shape exactly.
  "src/generator/elixir/domain-service-emit.ts#substituteRefs": {
    deferred:
      "MISFILED by the old bucket: `default: return e` — a silent no-op, not a throw. It is an IR→IR MAP (workflow call-arg inlining) whose unhandled kinds (list / match / convert / i18nFormat / duration / lambda) leave a `param` ref unsubstituted, i.e. the M-T6.50 silent-drop shape. A walk.ts migration candidate, CR1-e's class",
    reviewUntil: "2026-12-31",
  },
  "src/generator/elixir/store-emit.ts#renderStoreStmt": {
    deferred:
      'MISFILED by the old bucket: `default: return { value: "state" }` — the statement is silently dropped and the struct passed through. Note the gate it would lean on does NOT cover it: `loom.ui-body-statement-kind` exempts `phoenixLiveView`, which is the only framework this emitter serves',
    reviewUntil: "2026-12-31",
  },
  "src/generator/elixir/store-emit.ts#renderStoreExpr": {
    deferred:
      'MISFILED by the old bucket: `default: return "nil"` — a store-action RHS outside the subset (a method call, a `match`, a conversion) silently becomes `nil` in the emitted Elixir, not a throw',
    reviewUntil: "2026-12-31",
  },
  "src/generator/elixir/vanilla/eventsourced-emit.ts#renderCommandRunner": {
    deferred:
      "MISFILED by the old bucket: `default: break` — the statement is silently dropped. The ES command discipline it cites does refuse assign/add/remove/call, but `expression` / `return` / `variant-match` were NOT re-verified against a gate in CR1-f",
    reviewUntil: "2026-12-31",
  },
  // PROVEN silent: `on(pr: PaymentRegistered) { let o = Orders.getById(pr.order) … }`
  // on an eventSourced workflow emits NOTHING for the `repo-let` on elixir
  // (measured), while node emits `const o = await orders.getById(pr.order)`.
  "src/generator/elixir/vanilla/workflow-eventsourced-emit.ts#renderEsWorkflowHandler": {
    deferred:
      "MISFILED by the old bucket, and PROVEN silent: `default: break` drops the statement. Measured — a `repo-let` in an eventSourced workflow's `on(...)` handler is ABSENT from the emitted Elixir on a `0 error(s), 0 warning(s)` model, while node emits it. Both a silent drop AND parity debt; hand-off row in docs/new-plan/waves/handoffs/wave-cr1-f.md",
    reviewUntil: "2026-12-31",
  },
  "src/generator/elixir/vanilla/workflow-execution-emit.ts#renderBranch": {
    deferred:
      "MISFILED by the old bucket: the terminal `else` does not throw — it routes every unlisted kind into the emit/resource-call branch renderer, so an `if-let` / `for-each` / `repo-delete` nested in an `if let` branch is mis-rendered rather than refused",
    reviewUntil: "2026-12-31",
  },
  // `default`-less and NOT total: assign/add/remove/emit/call/variant-match
  // fall out of the loop, pushing no line.  Unreachable, but by a gate the
  // bucket never named.
  "src/generator/elixir/vanilla/function-emit.ts#renderPureBlock": {
    deferred:
      "MISFILED by the old bucket: there is no `default` and no throw — six kinds simply push no line. `loom.function-block-impure` (structural-checks.ts) refuses mutation / `emit` / any impure call in a `function` body and the caller re-asserts `loom.elixir-if-stmt-unsupported`, which covers five of the six; `variant-match` was NOT separately verified, so this is deferred rather than standing",
    reviewUntil: "2026-12-31",
  },

  // -- the CR1-f gate itself ------------------------------------------------
  // Deliberately NOT `never`-checked, and the reason is the point of the gate:
  // its `default` REFUSES.  A new `ExprIR` kind therefore fails CLOSED here (a
  // refusal the author can read) rather than falling through into the three
  // renderers' `throw`, which is the failure mode this whole packet exists to
  // remove.  An exhaustive arm would have to spell the identical refusal 21
  // times and would still be the same behaviour.  Same shape, same reason, as
  // its twin `ui-action-body-checks.ts#toastMessageProblem`.
  "src/ir/validate/checks/ui-framework-checks.ts#pageGateProblem": {
    standing:
      "a REFUSING default — a new ExprIR kind fails closed into `loom.ui-gate-expr-unsupported` (a readable refusal) instead of the gate renderers' bare `throw`, which is the direction this check exists to enforce; an exhaustive arm would repeat the same refusal 21 times",
  },

  // -- not re-verified this packet ------------------------------------------
  // The only genuine deferral left.  Its own comment argues all three missing
  // kinds (`this`, `action-ref`, `authz-filter`) are shapes the frontend
  // pipeline does not produce; that argument was READ, not probed, and a
  // probe is what this wave is about.
  "src/generator/feliz/fs-expr.ts#renderFsExpr": {
    deferred:
      "a real throw, and the site's own comment argues its three missing kinds (`this`, `action-ref`, `authz-filter`) are never produced by the frontend pipeline — an argument CR1-f READ but did not probe. Re-verify with a `.ddd` that puts an `action-ref` in an update-arm value position before promoting to `standing`",
    reviewUntil: "2026-12-31",
  },

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
