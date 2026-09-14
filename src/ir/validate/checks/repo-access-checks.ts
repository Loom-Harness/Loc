// ---------------------------------------------------------------------------
// `loom.repository-access-outside-workflow` — a repository may only be named
// where a backend actually has one in scope.
//
// A repository name is VISIBLE to the expression type-checker from anywhere in
// its context, but it only RESOLVES in the three body kinds that own
// infrastructure.  `lower-expr.ts`'s repo-read probe fires only when
// `env.serviceRepos` is set (a `domainService` body); `lower-workflow.ts`
// recognises the same shape and lowers it to a `repo-run` / `repo-let`
// workflow statement.  An aggregate / part / value-object member body goes
// through neither, so `Technicians.getById(x)` there lowers to a plain
// `method-call` whose receiver is a bare `ref` with `refKind: "unknown"` — and
// every backend renders an unresolved receiver verbatim.
//
// Re-verified 2026-09-13 on fresh `main` (`bcd25e3e`), one `.ddd` per backend,
// `aggregate Job { operation assign(assignTo: Technician id) { precondition
// Technicians.getById(assignTo).skills.contains(requiredSkill) … } }`.
// `ddd parse` reports ZERO diagnostics and all five backends emit a dangling
// identifier into the DOMAIN class, which binds no repository:
//
//   TS     — `domain/job.ts`: `Technicians.getById(assignTo).skills.includes(…)`
//            → TS2304 "Cannot find name 'Technicians'".
//   .NET   — `Domain/Jobs/Job.cs`: `Technicians.GetById(assignTo).Skills…`
//            → CS0103.
//   Java   — `features/jobs/Job.java`: `Technicians.getById(assignTo).skills()`
//            → "cannot find symbol".
//   Python — `app/domain/job.py`: `Technicians.get_by_id(assign_to).skills`
//            → NameError / F821.
//   Phoenix— `lib/<app>/ops.ex`: `technicians.get_by_id(assign_to).skills`
//            → "undefined variable technicians" (the ref is snake-cased into a
//            local that was never bound).
//
// So this is one MODEL-level shape that no backend supports, not five
// per-backend gaps — the same call the repo's parity policy makes for
// `loom.resource-op-outside-workflow` (#2618) and
// `loom.domain-service-cross-context-read`: reject at the source rather than
// let five emitters fail five different silent ways.
//
// AND IT IS A LANGUAGE RULE, NOT PLUMBING.  An aggregate `operation` is a
// single-aggregate state transition over state that is already loaded; loading
// ANOTHER aggregate is the workflow's job (`docs/workflow.md` — the workflow
// owns the transaction and the loads; `docs/domain-services.md` — a
// `domainService` may run read-only queries).  Threading a repository handle
// into a domain constructor would make every aggregate method potentially
// IO-bound and async on four of five backends, re-opening the transaction
// boundary the workflow exists to own.  The honest answer is an error with the
// workflow spelled out in it.
//
// SCOPE.  The gate keys on a bare `ref` that (a) did not resolve
// (`refKind: "unknown"`, so a param / `let` / field shadowing the name is
// never flagged) and (b) names a repository declared ANYWHERE in the model —
// a same-context one (the reported shape) and a cross-context one (equally
// dangling, and the aggregate-side twin of
// `loom.domain-service-cross-context-read`) alike.
//
// SURFACES.  Every aggregate / part / value-object body that renders into
// DOMAIN code: `operation` bodies (and `create` / `destroy` bodies + their
// `when` guards), `invariant` expressions and guards, `derived` expressions,
// and `function` bodies in BOTH forms.  Each was verified to validate clean
// today except the block-body `function`, which already trips
// `loom.function-block-impure` — that gate fires on the METHOD CALL and tells
// the author to "move the logic into an 'operation'", which for a repository
// read is advice to write the exact defect this gate rejects.  So the two fire
// together there on purpose: the impurity one states the rule the body broke,
// this one names the repository and points at the workflow.
//
// NOT in scope: `test { }` bodies and repository `find` filters.  Both are
// separate rendering positions with their own gates, and neither was part of
// the reported shape — a repository ref there is left to the existing
// non-queryability / test gates rather than claimed on an unverified basis.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import type { BoundedContextIR, ExprIR, FunctionIR, StmtIR } from "../../types/loom-ir.js";
import { walkExprDeep, walkStmtExprsDeep } from "../../util/walk.js";
import type { LoomDiagnostic } from "./diagnostic.js";

/** Every repository name declared in the model, local context first.  A name
 *  is enough: the diagnostic names the repository the author wrote, and a
 *  duplicate name across contexts is already a workspace-uniqueness error. */
function repositoryNames(allCtxs: readonly BoundedContextIR[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const ctx of allCtxs) {
    for (const repo of ctx.repositories) names.add(repo.name);
  }
  return names;
}

/** `loom.repository-access-outside-workflow` — see the header note above. */
export function validateMemberRepositoryAccess(
  ctx: BoundedContextIR,
  diags: LoomDiagnostic[],
  allCtxs: readonly BoundedContextIR[],
): void {
  const repos = repositoryNames(allCtxs);
  if (repos.size === 0) return;
  // One diagnostic per (member, repository) — a body reading the same
  // repository three times states the same boundary problem once.
  const seen = new Set<string>();
  const flag = (where: string, source: string, expr: ExprIR | undefined): void => {
    walkExprDeep(expr, (e) => {
      if (e.kind !== "ref" || e.refKind !== "unknown" || !repos.has(e.name)) return;
      const key = `${source} ${e.name}`;
      if (seen.has(key)) return;
      seen.add(key);
      diags.push({
        severity: "error",
        code: "loom.repository-access-outside-workflow",
        message: diagMessage("loom.repository-access-outside-workflow", {
          where,
          repoName: e.name,
        }),
        source,
      });
    });
  };
  const flagStmts = (where: string, source: string, stmts: readonly StmtIR[]): void => {
    for (const s of stmts) walkStmtExprsDeep(s, (e) => flag(where, source, e));
  };
  const flagFunction = (where: string, source: string, fn: FunctionIR): void => {
    if ("expr" in fn.body) flag(where, source, fn.body.expr);
    else flagStmts(where, source, fn.body.stmts);
  };
  /** The member surfaces an aggregate, an entity part and a value object share
   *  — invariants (expression + `when` guard), `derived` expressions, and
   *  `function` bodies.  `kind` spells the owner out in the message ("on
   *  aggregate 'Job'" / "on entity 'Line'" / "on valueobject 'Money'"). */
  const flagSharedMembers = (
    kind: string,
    owner: string,
    members: {
      invariants: readonly { expr: ExprIR; guard?: ExprIR }[];
      derived: readonly { name: string; expr: ExprIR }[];
      functions: readonly FunctionIR[];
    },
  ): void => {
    const on = `${kind} '${owner}'`;
    for (const inv of members.invariants) {
      flag(`an invariant on ${on}`, `${ctx.name}/${owner}.invariant`, inv.expr);
      flag(`an invariant on ${on}`, `${ctx.name}/${owner}.invariant`, inv.guard);
    }
    for (const d of members.derived) {
      flag(`derived '${d.name}' on ${on}`, `${ctx.name}/${owner}.derived[${d.name}]`, d.expr);
    }
    for (const fn of members.functions) {
      flagFunction(
        `function '${fn.name}' on ${on}`,
        `${ctx.name}/${owner}.function[${fn.name}]`,
        fn,
      );
    }
  };
  for (const agg of ctx.aggregates) {
    // `creates` / `destroys` are separate arrays from `operations`, and a
    // lifecycle `requires` guard is a statement inside them, so walking all
    // three statement lists covers those guards too.
    for (const op of agg.operations) {
      const where = `operation '${op.name}' on aggregate '${agg.name}'`;
      const source = `${ctx.name}/${agg.name}.${op.name}`;
      flagStmts(where, source, op.statements);
      flag(where, source, op.when);
    }
    for (const op of [...(agg.creates ?? []), ...(agg.destroys ?? [])]) {
      const label = op.name || "create";
      const where = `the '${label}' body on aggregate '${agg.name}'`;
      const source = `${ctx.name}/${agg.name}.${label}`;
      flagStmts(where, source, op.statements);
      flag(where, source, op.when);
    }
    flagSharedMembers("aggregate", agg.name, agg);
    for (const part of agg.parts) flagSharedMembers("entity", part.name, part);
  }
  for (const vo of ctx.valueObjects) flagSharedMembers("valueobject", vo.name, vo);
}
