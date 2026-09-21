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
// Waivers RATCHET (CLAUDE.md Conventions): a waiver whose site no longer
// exists, or whose site has since become exhaustive, fails the second test
// below — so a stale entry cannot silently outlive the code it excuses.
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

// ---------------------------------------------------------------------------
// Waivers — every entry names the exact site (file + enclosing function) and
// a reason. Ratcheted by the second test below: a waiver whose site is gone,
// or whose site has since become exhaustive, fails and must be deleted.
//
// This packet fixed or certified the sites whose intent was clearly "visit
// every reachable sub-node" (a collector/predicate silently dropping a kind
// — the M-T6.50 class) or that were already exhaustive by case count and
// only needed the `never`-check ceremony (verified by an exact case-set
// diff against `walk.ts`'s own kind enumeration — see the prior commits on
// this branch). The remaining sites below fall into four honestly-different
// buckets; the reason each one carries says which.
// ---------------------------------------------------------------------------

const HOTSPOT_SPLIT_REASON =
  "packet 2.3 identified this hand-rolled switch/if-chain as a genuine walk.ts migration candidate but left it for the 2.6 hotspot-split (docs/new-plan/waves/wave-2.md) to relocate first; 2.6's split is a purely mechanical move (no logic change), so the site itself is unchanged — the migration itself remains a follow-up drain, tracked at its new post-split location below";

const INFLIGHT_2736 =
  "in-flight fence (docs/new-plan/waves/wave-2.md): PR #2736 (M-FT.1, wire `== null`) owns zod-refine.ts this wave — do not edit its hunks";

const INFLIGHT_2729 =
  "in-flight fence (docs/new-plan/waves/wave-2.md): PR #2729 (W4 frontend collection ops) owns this file's walker engine this wave — do not edit its hunks";

const INFLIGHT_2742 =
  "in-flight fence (docs/new-plan/waves/wave-2.md): PR #2742 (Hono runtime hardening) is named as owning the hono workflow builders this wave in the packet brief — do not edit their hunks, even though this file's own diff had not yet reached them as of the fence read";

/** A closed, kind-specific PREDICATE or CLASSIFIER: every kind the switch
 *  does not explicitly list falls through to a deliberate, safe, generic
 *  value (`false` / `undefined` / `null` / `[]` / the neutral branch already
 *  documented at the call site) — not a traversal, and nothing is silently
 *  dropped from emitted OUTPUT the way the M-T6.50 class drops it (a
 *  narrower classification is the worst case, never a missing emission).
 *  Classified by each site's `default` shape (verified with the census's
 *  own detector, not re-read line-by-line against every current
 *  `ExprIR`/`StmtIR`/`WorkflowStmtIR` kind in this packet) — a genuine
 *  follow-up drain re-reads each one and either migrates it onto
 *  `walk.ts` or upgrades it to an explicit `never`-checked closed form. */
const CLOSED_PREDICATE =
  "closed, kind-specific predicate/classifier — every unhandled kind falls through to a safe, generic default; not a traversal, nothing silently drops from emitted output. Classified by default-arm shape, not individually re-verified per kind this packet; follow-up drain";

/** ===========================================================================
 *  CR1-f (wave CR1, audit row P0-2b) — the `THROWING_DISPATCHER` bucket, drained.
 *
 *  The bucket carried 32 entries behind one blanket reason: "closed emission
 *  dispatcher whose default arm THROWS for an unhandled kind (loud failure,
 *  not the silent-drop class this census targets)".  The audit's objection,
 *  acted on here: for a GENERATOR, "loud" means `ddd generate system` dies on
 *  a valid `.ddd` — this repo's own definition of a SILENT gap, as opposed to
 *  an HONEST gap (a `loom.*` diagnostic that refuses it at parse time with an
 *  explanation).  So each of the 32 was re-read against the CURRENT kind list
 *  from `walk.ts` (scripted, not eyeballed) and, where the vocabulary was
 *  short, probed with a real `.ddd` through the CLI.
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
 *  The per-site strings below replace the blanket constant.  Entries reading
 *  `standing:` are unreachable-by-construction with a cited gate; `parity:`
 *  and `deferred:` name work that is owed, with its owner.  (CR1-d's typed
 *  `{ standing } | { deferred, reviewUntil, blockedBy }` waiver shape is not
 *  on this branch — the coordinator wraps these at the fold; the prefixes are
 *  written so the wrapping is mechanical.)
 *  ======================================================================== */

/** The `toast(<expr>)` message subset.  `checkToastMessages`
 *  (`ui-action-body-checks.ts`) mirrors these four `switch`es ARM FOR ARM —
 *  literal / the event binding / a member chain off it / paren / binary — and
 *  refuses everything else at phase ⑦ before any renderer runs. */
const STANDING_TOAST_SUBSET =
  "standing: unreachable — `loom.toast-message-unsupported` (src/ir/validate/checks/ui-action-body-checks.ts#toastMessageProblem) bounds the `toast(…)` message to exactly this switch's vocabulary, arm for arm, at phase ⑦";

/** The page `requires` gate subset.  Minted in THIS packet after the crash was
 *  measured: `page Welcome { requires string(currentUser.role) == "admin" }`
 *  on an `auth: ui` svelte deployable printed `0 error(s), 0 warning(s)` and
 *  then died with `Error: UI gate: expression kind 'convert' is not supported
 *  in a UI gate`. */
const STANDING_UI_GATE_SUBSET =
  "standing: unreachable — `loom.ui-gate-expr-unsupported` (src/ir/validate/checks/ui-framework-checks.ts#pageGateProblem, CR1-f) bounds a page `requires` gate to exactly this switch's vocabulary at phase ⑦; before it, this arm was a measured codegen crash (test/ir/ui-page-gate-expr.test.ts)";

/** The queryable sublanguage.  `firstNonQueryableNode`
 *  (`ir/validate/checks/shared.ts`) is exhaustive + `never`-checked and admits
 *  only: literal, ref (6 refKinds), paren, unary `!`, comparison/boolean
 *  binary (+ the `datetime ± duration` temporal form), `this.<col>` /
 *  `currentUser.<claim>` member, `contains` / queryable-intrinsic method-call,
 *  and `authz-filter`.  CR1-f closed the three leaves it used to admit that no
 *  query renderer emits — bare `this`, bare `id` and a standalone `duration`
 *  — each measured as a `QueryEmissionRefusal` crash on a `0 error(s)` model
 *  (test/ir/queryable-non-column-leaves.test.ts). */
const STANDING_QUERYABLE_SUBSET =
  "standing: unreachable — every predicate reaching here passes `firstNonQueryableNode` (src/ir/validate/checks/shared.ts), whose admitted set is exactly this switch's vocabulary; the three leaves it used to over-admit (`this`, `id`, a standalone `duration`) are refused by `loom.find-where-not-queryable` as of CR1-f, and the residue routes through `loom.query-emission-invalid` rather than a bare Error";

/** A ui `action` / MVU-update body.  Three phase-⑦ gates between them refuse
 *  every statement kind these switches omit. */
const STANDING_UI_BODY_VOCAB =
  "standing: unreachable — `loom.ui-body-statement-kind` (return/precondition/requires on every non-LiveView frontend), `loom.if-stmt-page-body-unsupported` (`if` anywhere in a ui body, every frontend) and phase-③ scope resolution (`emit` has no aggregate to emit from in ui scope) refuse every kind this switch omits";

/** Handed to the `parity-auditor` skill: a shape a DIFFERENT backend emits
 *  today, so the refusal is not a language limit — it is one target behind.
 *  Detail per site; the full rows are in
 *  `docs/new-plan/waves/handoffs/wave-cr1-f.md`. */
const PARITY_ELIXIR_REACTOR_STMTS =
  "parity (CR1-f hand-off, `parity-auditor`): MEASURED reachable on four kinds — `repo-delete` / `resource-call` / `domain-service-call` / `if-let` in a workflow reactor body each print `0 error(s), 0 warning(s)` and then abort `ddd generate system` with `dispatch-emit: unsupported reactor statement kind '<k>'`, while `platform: node` emits all four. Not a language limit and not a diagnostic — one backend behind. Do NOT re-waive as `standing`";

/** A shallow, ONE-LEVEL child-list builder (an `exprChildren`-shaped
 *  function) feeding a caller's own recursion — structurally the same
 *  concept as `walk.ts`'s `walkExprChildren`, and a genuine migration
 *  candidate, but not completed in this packet's time-box. */
const SHALLOW_CHILD_BUILDER =
  "one-level child-list builder (walkExprChildren-shaped) feeding the caller's own recursion — a genuine walk.ts migration candidate not completed in this packet's time-box; follow-up drain";

/** A hand-rolled recursive traversal (`walk`/`visit`/collector-shaped) this
 *  packet identified as a genuine migration candidate but did not reach —
 *  either because it composes with an already-migrated sibling in the same
 *  cluster (so the isolated risk is lower) or purely on time-box grounds. */
const TRAVERSAL_TIME_BOXED =
  "hand-rolled traversal identified as a walk.ts migration candidate; not completed in this packet's time-box — follow-up drain (see the hand-off note for the per-file priority order)";

/** Already rides a sanctioned walker (`walkWorkflowStmtChildren` /
 *  `walkExprDeep`) for the RECURSION step, with its own narrow, local
 *  per-kind logic layered on top (order-preserving, migrated this packet) —
 *  the census's if-chain detector still flags the local `if`/`||` guard
 *  itself (a narrow membership test, not a full dispatch), which a
 *  terminal `never`-checked `else` does not fit. */
const DELEGATES_TO_SANCTIONED_WALKER =
  "already rides walkWorkflowStmtChildren/walkExprDeep for recursion (migrated this packet); the flagged if/`||` guard is a narrow kind-membership test layered on top, not a dispatch needing full-kind coverage";

const WAIVERS: Record<string, string> = {
  // --- 2.6 hotspot-split fence: system-checks.ts / ui-checks.ts / mikroorm.ts
  // were mechanically split into per-theme leaves by packet 2.6
  // (docs/new-plan/waves/handoffs/wave-2-hotspot-splits.md).  These eleven
  // sites are pure relocations of the same 2.3-flagged offenders — same
  // code, same reason, new home; the walk.ts migration itself is still a
  // follow-up drain, not done here.
  "src/ir/validate/checks/datasource-checks.ts#docExprUnsupported": HOTSPOT_SPLIT_REASON,
  "src/ir/validate/checks/datasource-checks.ts#docFunctionUnsupported": HOTSPOT_SPLIT_REASON,
  "src/ir/validate/checks/datasource-checks.ts#docStmtUnsupported": HOTSPOT_SPLIT_REASON,
  "src/ir/validate/checks/backend-syntax-checks.ts#eachStmtExpr": HOTSPOT_SPLIT_REASON,
  "src/ir/validate/checks/ui-action-body-checks.ts#checkBody": HOTSPOT_SPLIT_REASON,
  "src/ir/validate/checks/ui-page-structure-checks.ts#directlyRenderedRefs": HOTSPOT_SPLIT_REASON,
  "src/ir/validate/checks/ui-page-structure-checks.ts#namesReadByBody": HOTSPOT_SPLIT_REASON,
  "src/ir/validate/checks/ui-action-body-checks.ts#toastMessageProblem": HOTSPOT_SPLIT_REASON,
  "src/ir/validate/checks/ui-action-body-checks.ts#visitExpr": HOTSPOT_SPLIT_REASON,
  "src/ir/validate/checks/ui-action-body-checks.ts#visitStmt": HOTSPOT_SPLIT_REASON,
  "src/generator/typescript/emit/mikroorm-filter.ts#filterValue": HOTSPOT_SPLIT_REASON,

  // --- in-flight PR fence (docs/new-plan/waves/wave-2.md §In-flight fence) --
  "src/generator/zod-refine.ts#refineRenderable": INFLIGHT_2736,
  "src/generator/zod-refine.ts#renderRefineExpr": INFLIGHT_2736,
  "src/generator/_walker/walker-core.ts#emitStmt": INFLIGHT_2729,
  "src/generator/_walker/walker-core.ts#walk": INFLIGHT_2729,
  "src/generator/elixir/heex-walker-core.ts#renderExpr": INFLIGHT_2729,
  "src/generator/elixir/heex-walker-core.ts#renderStmt": INFLIGHT_2729,
  "src/platform/hono/v4/workflow-builder.ts#exprChildren": INFLIGHT_2742,
  "src/platform/hono/v4/workflow-builder.ts#walk": INFLIGHT_2742,
  "src/platform/hono/v4/workflow-builder.ts#walk$2": INFLIGHT_2742,
  "src/platform/hono/v4/workflow-builder.ts#workflowStmtExprs": INFLIGHT_2742,
  "src/platform/hono/v4/workflow-eventsourced-builder.ts#renderApplierStmt": INFLIGHT_2742,
  "src/platform/hono/v4/projection-builder.ts#renderFoldStatement": INFLIGHT_2742,

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

  // --- CR1-f: the former `THROWING_DISPATCHER` bucket, per-site ------------
  // 32 in, 27 out.  FIVE waivers DELETED, not rewritten — `mermaid.ts`'s two,
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
  "src/generator/sql-pg-expr.ts#renderSqlScalarExpr":
    "standing: unreachable — `loom.migration-expr-unsupported` (src/ir/validate/checks/migration-checks.ts) bounds a backfill expression to the SQL-renderable subset at phase ⑦, and the default arm routes through `refuseOutOfVocabulary` so even a validator bypass surfaces `loom.query-emission-invalid`, not a bare Error",

  // -- unreachable: the ui action / MVU-update statement vocabulary ----------
  "src/generator/feliz/update-emit.ts#renderUpdateStmt": STANDING_UI_BODY_VOCAB,
  // This site's own comment already cites the four gates per kind and was
  // re-checked against them; kept verbatim as the reason.
  "src/generator/flutter/riverpod-emit.ts#renderNotifierStmt": STANDING_UI_BODY_VOCAB,

  // -- unreachable: the aggregate applier / pure-function discipline ---------
  // `loom.applier-emits` / `-impure-call` / `-guard` (structural-checks.ts,
  // "Rule 4 — applier bodies are pure folds") refuse `emit` / `call` /
  // `precondition` / `requires`; the `if` sub-shapes are refused by
  // `loom.elixir-if-stmt-unsupported`, re-asserted by this file's caller with
  // the SAME predicate (`elixirIfRefusal`).
  "src/generator/elixir/vanilla/fold-stmt-emit.ts#renderFoldStatement":
    "standing: unreachable — `loom.applier-emits` / `loom.applier-impure-call` / `loom.applier-guard` (src/ir/validate/checks/structural-checks.ts, applier rule 4) refuse emit/call/precondition/requires in an applier body, and `loom.elixir-if-stmt-unsupported` refuses the `if` shapes this fold cannot thread",
  // The throw is CAUGHT: `renderTest` rescues `UnsupportedTestShapeError` and
  // degrades the case to `@tag :skip`, so this is not a codegen abort at all.
  // (That the skip is invisible in a green `mix test` run is a real
  // verification gap — recorded in the hand-off, owned by CR1-h, not here.)
  "src/generator/elixir/vanilla/tests-emit.ts#vtExpr":
    "standing: not a codegen abort — the typed `UnsupportedTestShapeError` this arm raises is caught by `renderTest` (same file, ~line 219) and degrades the case to `@tag :skip`; only a NON-`UnsupportedTestShapeError` propagates, which is the deliberate emitter-bug signal",

  // -- PARITY DEBT: reachable, and another backend emits it -----------------
  "src/generator/elixir/dispatch-emit.ts#renderStmt": PARITY_ELIXIR_REACTOR_STMTS,
  "src/generator/python/workflow-eventsourced-emit.ts#renderApplierStmt":
    "parity (CR1-f hand-off, `parity-auditor`): MEASURED reachable — a `let` binding in an event-sourced workflow's `apply(...)` fold prints `0 error(s), 0 warning(s)` and then aborts with `python es-workflow applier: unexpected statement kind 'let'`, while elixir / java / .NET all emit it (node crashes identically at src/platform/hono/v4/workflow-eventsourced-builder.ts, whose waiver is INFLIGHT_2742's, not this bucket's). Two backends behind, not a language limit",

  // -- MISFILED: the default arm does not throw ----------------------------
  // Best-effort by design and documented as such (`renderDefaultSeed` returns
  // null so the caller keeps its type-zero seed) — the ONE member of this
  // group whose silent default is correct.  It is still misfiled.
  "src/generator/_frontend/default-seed.ts#renderDefaultSeed":
    "MISFILED by the 2.3 bucket: `default: return null` — a documented BEST-EFFORT fallback (the caller keeps its type-zero seed), never a throw. Correct behaviour, wrong bucket; it is a CLOSED_PREDICATE (packet CR1-e's class)",
  // An IR→IR substitution map, not an emitter: `default: return e` leaves a
  // `param` ref UNSUBSTITUTED inside a `list` / `match` / `convert` /
  // `i18nFormat` / `duration` / `lambda`, which emits Elixir naming an
  // undefined variable — the #2720/M-T6.50 shape exactly.
  "src/generator/elixir/domain-service-emit.ts#substituteRefs":
    "MISFILED by the 2.3 bucket: `default: return e` — a silent no-op, not a throw. It is an IR→IR MAP (workflow call-arg inlining) whose unhandled kinds (list / match / convert / i18nFormat / duration / lambda) leave a `param` ref unsubstituted, i.e. the M-T6.50 silent-drop shape. Migration candidate, CR1-e's class",
  "src/generator/elixir/store-emit.ts#renderStoreStmt":
    'MISFILED by the 2.3 bucket: `default: return { value: "state" }` — the statement is silently dropped and the struct passed through. Note the gate it leans on does NOT cover it: `loom.ui-body-statement-kind` exempts `phoenixLiveView`, which is the only framework this emitter serves',
  "src/generator/elixir/store-emit.ts#renderStoreExpr":
    'MISFILED by the 2.3 bucket: `default: return "nil"` — a store-action RHS outside the subset (a method call, a `match`, a conversion) silently becomes `nil` in the emitted Elixir, not a throw',
  "src/generator/elixir/vanilla/eventsourced-emit.ts#renderCommandRunner":
    "MISFILED by the 2.3 bucket: `default: break` — the statement is silently dropped. The ES command discipline it cites does refuse assign/add/remove/call, but `expression` / `return` / `variant-match` were NOT re-verified against a gate this packet",
  // PROVEN silent: `on(pr: PaymentRegistered) { let o = Orders.getById(pr.order) … }`
  // on an eventSourced workflow emits NOTHING for the `repo-let` on elixir
  // (measured), while node emits `const o = await orders.getById(pr.order)`.
  "src/generator/elixir/vanilla/workflow-eventsourced-emit.ts#renderEsWorkflowHandler":
    "MISFILED by the 2.3 bucket, and PROVEN silent: `default: break` drops the statement. Measured — a `repo-let` in an eventSourced workflow's `on(...)` handler is ABSENT from the emitted Elixir on a `0 error(s), 0 warning(s)` model, while node emits it. Both a silent drop AND parity debt; hand-off row in docs/new-plan/waves/handoffs/wave-cr1-f.md",
  "src/generator/elixir/vanilla/workflow-execution-emit.ts#renderBranch":
    "MISFILED by the 2.3 bucket: the terminal `else` does not throw — it routes every unlisted kind into the emit/resource-call branch renderer, so an `if-let` / `for-each` / `repo-delete` nested in an `if let` branch is mis-rendered rather than refused",
  // `default`-less and NOT total: assign/add/remove/emit/call/variant-match
  // fall out of the loop, pushing no line.  Unreachable, but by a gate the
  // bucket never named.
  "src/generator/elixir/vanilla/function-emit.ts#renderPureBlock":
    "MISFILED by the 2.3 bucket: there is no `default` and no throw — six kinds simply push no line. Unreachable in practice: `loom.function-block-impure` (structural-checks.ts) refuses mutation / `emit` / any impure call in a `function` body, and the caller re-asserts `loom.elixir-if-stmt-unsupported`; `variant-match` was not separately verified",

  // -- the CR1-f gate itself ------------------------------------------------
  // Deliberately NOT `never`-checked, and the reason is the point of the gate:
  // its `default` REFUSES.  A new `ExprIR` kind therefore fails CLOSED here (a
  // refusal the author can read) rather than falling through into the three
  // renderers' `throw`, which is the failure mode this whole packet exists to
  // remove.  An exhaustive arm would have to spell the identical refusal 21
  // times and would still be the same behaviour.  Same shape, same reason, as
  // its twin `ui-action-body-checks.ts#toastMessageProblem`.
  "src/ir/validate/checks/ui-framework-checks.ts#pageGateProblem":
    "standing: a REFUSING default — a new ExprIR kind fails closed into `loom.ui-gate-expr-unsupported` (a readable refusal) instead of the gate renderers' bare `throw`, which is the direction this check exists to enforce; an exhaustive arm would repeat the same refusal 21 times",

  // -- not re-verified this packet ------------------------------------------
  // The only genuine deferral left.  Its own comment argues all three missing
  // kinds (`this`, `action-ref`, `authz-filter`) are shapes the frontend
  // pipeline does not produce; that argument was READ, not probed, and a
  // probe is what this wave is about.
  "src/generator/feliz/fs-expr.ts#renderFsExpr":
    "deferred (CR1-f): a real throw, and the site's own comment argues its three missing kinds (`this`, `action-ref`, `authz-filter`) are never produced by the frontend pipeline — an argument this packet READ but did not probe. Re-verify with a `.ddd` that puts an `action-ref` in an update-arm value position before promoting to `standing`",

  // --- shallow one-level child-list builders (walkExprChildren-shaped) -----
  "src/generator/feliz/wire.ts#exprChildren": SHALLOW_CHILD_BUILDER,
  "src/generator/flutter/forms-emit.ts#exprChildren": SHALLOW_CHILD_BUILDER,
  "src/generator/flutter/inputs-emit.ts#exprChildren": SHALLOW_CHILD_BUILDER,
  "src/generator/flutter/reads-emit.ts#exprChildren": SHALLOW_CHILD_BUILDER,

  // --- hand-rolled traversals identified but not migrated this session -----
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
