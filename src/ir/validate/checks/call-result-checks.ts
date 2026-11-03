// ---------------------------------------------------------------------------
// `loom.workflow-mutation-result-unmatched` — a mutating call whose result can
// be an error, bound with `let` in a workflow / handler body.
//
// `let r = a.withdraw(x)` over `withdraw(): int or Insufficient` mutates `a`
// tentatively: an operation that answers its `error` variant leaves no trace
// (D-FAILURE-MODEL), so `a` may be saved only where `r` is known not to be the
// error.  The lowering places that save at the end of each non-error arm of a
// statement `match` over `r` (and leaves it out of every exit save), so the
// body is sound exactly when:
//
//   * `r` is matched by a statement `match` (the default message) — without
//     one nothing saves `a`;
//   * no `else` of that match covers a success variant AND an error variant
//     (`#mixed-else`) — such an arm cannot tell whether to commit;
//   * the call is the body's only change to `a`, and `a` was not created in
//     the body (`#also-mutated`) — any other change or a create saves `a`
//     outside the match, which would write the error path's change too.
//
// The same holds for a `mutating` domain service bound with `let`
// (`let r = Transfer.run(src, dst, amount)` over an error-carrying result): its
// mutated aggregate arguments take the place of `a`.
//
// `loom.elixir-bound-mutating-call-unsupported` refuses every `let`-bound
// mutating call in a body an elixir deployable emits.  A Phoenix context
// operation persists inside its own function, so the bound form needs the
// call's `{:ok, value}` / `{:error, "Tag", fields}` tuple bound instead of
// matched away at each with-chain site that renders an op call, and a
// `mutating` domain service is inlined clause by clause, which computes no
// value to bind.
// ---------------------------------------------------------------------------

import { diagMessage } from "../../../diagnostics/messages.js";
import { variantTag } from "../../stdlib/unions.js";
import type { EffectIR } from "../../types/effect-ir.js";
import type { EnrichedLoomModel, WorkflowStmtIR } from "../../types/loom-ir.js";
import type { OriginRef } from "../../types/origin.js";
import { type EffectBodyIR, isGuardedCall } from "../../util/effects.js";
import { entryResult } from "../../util/entry-result.js";
import { walkWorkflowStmtsDeep } from "../../util/walk.js";
import {
  commandCreateEntryResult,
  commandCreateResult,
} from "../../util/workflow-command-route.js";
import type { LoomDiagnostic } from "./diagnostic.js";

export interface CallResultSite {
  owner: string;
  source: string;
  origin?: OriginRef;
}

type GuardedCall = Extract<WorkflowStmtIR, { kind: "op-call" | "domain-service-call" }>;

function callText(st: GuardedCall): string {
  return st.kind === "op-call" ? `${st.target}.${st.op}` : `${st.service}.${st.op}`;
}

/** Check every guarded call of one body.  `effects` is the body's effect list
 *  (with a resolver), which names the aggregates each call mutates. */
export function checkGuardedCallResults(
  body: EffectBodyIR,
  effects: readonly EffectIR[],
  site: CallResultSite,
  diags: LoomDiagnostic[],
): void {
  const guarded: GuardedCall[] = [];
  const matches: Extract<WorkflowStmtIR, { kind: "variant-match" }>[] = [];
  for (const root of body.statements) {
    walkWorkflowStmtsDeep(root, (st) => {
      if ((st.kind === "op-call" || st.kind === "domain-service-call") && isGuardedCall(st)) {
        guarded.push(st);
      } else if (st.kind === "variant-match") {
        matches.push(st);
      }
    });
  }
  for (const call of guarded) {
    const result = call.result!;
    const name = result.name;
    const call$ = callText(call);
    const over = matches.filter((m) => m.subject.kind === "ref" && m.subject.name === name);
    if (over.length === 0) {
      diags.push({
        severity: "error",
        code: "loom.workflow-mutation-result-unmatched",
        message: diagMessage("loom.workflow-mutation-result-unmatched", {
          owner: site.owner,
          name,
          call: call$,
          errors: result.errorVariants.map((v) => `'${v}'`).join(", "),
        }),
        source: site.source,
        origin: call.origin ?? site.origin,
      });
      continue;
    }
    for (const m of over) {
      if (!m.elseBody) continue;
      const armTags = new Set(m.arms.map((a) => variantTag(a.varType)));
      const uncovered =
        result.type.kind === "union"
          ? result.type.variants.map(variantTag).filter((t) => !armTags.has(t))
          : [];
      const errors = uncovered.filter((t) => result.errorVariants.includes(t));
      const successes = uncovered.filter((t) => !result.errorVariants.includes(t));
      if (errors.length > 0 && successes.length > 0) {
        diags.push({
          severity: "error",
          code: "loom.workflow-mutation-result-unmatched",
          message: diagMessage("loom.workflow-mutation-result-unmatched#mixed-else", {
            owner: site.owner,
            name,
            call: call$,
            successes: successes.map((v) => `'${v}'`).join(", "),
            errors: errors.map((v) => `'${v}'`).join(", "),
          }),
          source: site.source,
          origin: m.origin ?? site.origin,
        });
      }
    }
    // The aggregates this call mutates, and whether anything else in the body
    // creates or changes them.
    const targets = new Set(
      effects.flatMap((e) =>
        e.kind === "mutate" && e.target.kind === "aggregate" && e.target.result === name
          ? [e.target.name]
          : [],
      ),
    );
    for (const target of targets) {
      if (target === "") continue;
      const elsewhere = effects.some(
        (e) =>
          (e.kind === "create" && e.binds === target) ||
          (e.kind === "mutate" &&
            e.target.kind === "aggregate" &&
            e.target.name === target &&
            e.target.result !== name),
      );
      if (!elsewhere) continue;
      diags.push({
        severity: "error",
        code: "loom.workflow-mutation-result-unmatched",
        message: diagMessage("loom.workflow-mutation-result-unmatched#also-mutated", {
          owner: site.owner,
          name,
          call: call$,
          target,
        }),
        source: site.source,
        origin: call.origin ?? site.origin,
      });
    }
  }
}

/** `loom.elixir-bound-mutating-call-unsupported` — see the file header. */
export function validateElixirBoundMutatingCalls(
  loom: EnrichedLoomModel,
  diags: LoomDiagnostic[],
): void {
  for (const sys of loom.systems) {
    const elixirHost = new Map<string, string>();
    for (const dep of sys.deployables) {
      if (dep.platform !== "elixir") continue;
      for (const cn of dep.contextNames) if (!elixirHost.has(cn)) elixirHost.set(cn, dep.name);
    }
    if (elixirHost.size === 0) continue;
    for (const mod of sys.subdomains) {
      for (const ctx of mod.contexts) {
        const depName = elixirHost.get(ctx.name);
        if (!depName) continue;
        const bodies: { where: string; stmts: readonly WorkflowStmtIR[] }[] = [
          ...ctx.workflows.flatMap((wf) =>
            [...wf.creates, ...(wf.subscriptions ?? [])].map((b) => ({
              where: `workflow '${wf.name}'`,
              stmts: b.statements,
            })),
          ),
          ...(ctx.commandHandlers ?? []).map((h) => ({
            where: `commandHandler '${h.name}'`,
            stmts: h.statements,
          })),
          ...(ctx.queryHandlers ?? []).map((h) => ({
            where: `queryHandler '${h.name}'`,
            stmts: h.statements,
          })),
        ];
        for (const { where, stmts } of bodies) {
          for (const root of stmts) {
            walkWorkflowStmtsDeep(root, (st) => {
              if ((st.kind !== "op-call" && st.kind !== "domain-service-call") || !st.result) {
                return;
              }
              diags.push({
                severity: "error",
                code: "loom.elixir-bound-mutating-call-unsupported",
                message: diagMessage("loom.elixir-bound-mutating-call-unsupported", {
                  where,
                  name: st.result.name,
                  call: callText(st),
                  deployable: depName,
                }),
                source: `${ctx.name}/${where}`,
                ...(st.origin ? { origin: st.origin } : {}),
              });
            });
          }
        }
      }
    }
  }
}

/** `loom.elixir-entry-result-unsupported` — a routed command entry point an
 *  elixir deployable emits whose result is an expected failure (`T or E`), or
 *  a workflow `create` answering the workflow itself (`return this`).  The
 *  other four backends run such an entry point in one transaction, roll it
 *  back whole on an error answer and translate the error at the edge; the
 *  Phoenix workflow / handler emitters have no tagged result and no rollback
 *  seam for it yet, so it is refused rather than emitted half-wired. */
export function validateElixirEntryResults(loom: EnrichedLoomModel, diags: LoomDiagnostic[]): void {
  for (const sys of loom.systems) {
    const elixirHost = new Map<string, string>();
    for (const dep of sys.deployables) {
      if (dep.platform !== "elixir") continue;
      for (const cn of dep.contextNames) if (!elixirHost.has(cn)) elixirHost.set(cn, dep.name);
    }
    if (elixirHost.size === 0) continue;
    for (const mod of sys.subdomains) {
      for (const ctx of mod.contexts) {
        const deployable = elixirHost.get(ctx.name);
        if (!deployable) continue;
        const push = (where: string, slug: "" | "#workflow-state") =>
          diags.push({
            severity: "error",
            code: "loom.elixir-entry-result-unsupported",
            message:
              slug === ""
                ? diagMessage("loom.elixir-entry-result-unsupported", { where, deployable })
                : diagMessage("loom.elixir-entry-result-unsupported#workflow-state", {
                    where,
                    deployable,
                  }),
            source: `${ctx.name}/${where}`,
          });
        for (const wf of ctx.workflows) {
          const r = commandCreateResult(wf);
          if (!r) continue;
          const where = `workflow '${wf.name}'`;
          if (commandCreateEntryResult(wf, ctx)) push(where, "");
          else if (r.type.kind === "entity" && r.type.name === wf.name)
            push(where, "#workflow-state");
        }
        for (const h of [...(ctx.commandHandlers ?? []), ...(ctx.queryHandlers ?? [])]) {
          if (!h.extern && entryResult(h, ctx)) push(`handler '${h.name}'`, "");
        }
      }
    }
  }
}
