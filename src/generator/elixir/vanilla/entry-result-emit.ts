// The Phoenix half of an expected-failure entry point — a workflow `create`,
// a `commandHandler` or a `queryHandler` whose result is `T or E`, and a
// workflow `create` answering the workflow itself (`return this`)
// (`src/ir/util/entry-result.ts`).
//
// The body runs inside `Repo.transaction` (the plan's
// `workflowRunsInTransaction`; a handler answering an entry result is wrapped
// the same way).  Its outcome is a tuple the transaction reads:
//
//   {:ok, {tag, value}}             a success variant — `value` is the raw
//                                   domain value: a scalar, a payload map, the
//                                   aggregate row (read back after the body's
//                                   saves) or the workflow's own state row;
//   {:error, {:variant, tag, data}} an `error` variant — the transaction
//                                   rolls back (every write, the error arm's
//                                   own, the saga row) and `PostCommit` drops
//                                   the events the body announced.
//
// The controller tags and serializes the success value through the same
// wire-shape serializers the REST reads use, and answers an error variant at
// its mapped status with its problem body.

import { errorVariantCode } from "../../../ir/enrich/wire-policy.js";
import { isScalarVariant } from "../../../ir/stdlib/unions.js";
import type {
  BoundedContextIR,
  ExprIR,
  WorkflowIR,
  WorkflowStmtIR,
} from "../../../ir/types/loom-ir.js";
import type { EntryResult, EntryResultLeaf } from "../../../ir/util/entry-result.js";
import { walkExprDeep, walkWorkflowStmtsDeep } from "../../../ir/util/walk.js";
import { elixirString } from "../../../util/naming.js";
import { DOMAIN_NAMES } from "../../_symbols/plan.js";
import { exErrorVariant } from "../wire-policy-ex.js";
import { elixirUnionScrutinee, elixirVariantPattern } from "./match-stmt-emit.js";
import { renderWireSerialize, renderWorkflowInstanceSerialize } from "./wire-serialize.js";

const N = DOMAIN_NAMES.elixir;

type MatchExpr = Extract<ExprIR, { kind: "match" }>;
type SubjectArm = MatchExpr["variantArms"][number];

/** The names a body binds to an aggregate op's result tuple: a context op
 *  answers a union success variant on the tagged wire, so a scalar arm over
 *  one unwraps `%{value: x}`. */
export function opResultNames(statements: readonly WorkflowStmtIR[]): Set<string> {
  const out = new Set<string>();
  for (const st of statements) {
    walkWorkflowStmtsDeep(st, (n) => {
      if (n.kind === "op-call" && n.result && n.result.errorVariants.length > 0) {
        out.add(n.result.name);
      }
    });
  }
  return out;
}

const reads = (e: ExprIR, name: string): boolean => {
  let hit = false;
  walkExprDeep(e, (x) => {
    if (x.kind === "ref" && x.name === name) hit = true;
  });
  return hit;
};

export interface EntryOutcomeOpts {
  render: (e: ExprIR) => string;
  /** `<App>.<Ctx>` — the context facade an aggregate leaf reads back through. */
  contextModule: string;
  /** Names bound to an op's tagged result tuple (`opResultNames`). */
  taggedSubjects: ReadonlySet<string>;
  /** The expression holding the workflow's own state row (`return this`). */
  selfValue?: string;
}

/** The outcome tuple of one leaf. */
function leafOutcome(leaf: EntryResultLeaf, o: EntryOutcomeOpts): string {
  const tag = JSON.stringify(leaf.arm.tag);
  switch (leaf.arm.kind) {
    case "error":
      return `{:error, {:variant, ${tag}, ${o.render(leaf.value)}}}`;
    case "value":
    case "payload":
      return `{:ok, {${tag}, ${o.render(leaf.value)}}}`;
    case "aggregate":
      // Read back after the body's saves: an op persisted the row and moved
      // its version, which the bound handle does not carry.
      return `(case ${o.contextModule}.get_${N.stem(leaf.arm.name)}(${o.render(leaf.value)}.id) do {:ok, row} -> {:ok, {${tag}, row}}; err -> err end)`;
    case "workflow":
      return `{:ok, {${tag}, ${o.selfValue ?? "state"}}}`;
  }
}

/** The outcome expression of an entry result: one leaf's tuple, or a `case`
 *  over the `match` subject choosing the leaf of the arm that ran. */
export function renderEntryOutcome(r: EntryResult, o: EntryOutcomeOpts): string {
  if (!r.match) return leafOutcome(r.leaves[0]!, o);
  const m = r.match;
  const subject = o.render(m.subject!);
  const binderFor = (leaf: EntryResultLeaf, arm: SubjectArm | undefined): string =>
    arm?.binding && reads(leaf.value, arm.binding) ? N.binding(arm.binding) : "_";
  if (m.subjectShape === "absence" || m.subjectType?.kind === "optional") {
    const isAbsent = (a: SubjectArm) => a.varType.kind === "none" || !!a.isError;
    const present = r.leaves.find((l) => l.subjectArm && !isAbsent(l.subjectArm));
    const absent = r.leaves.find((l) => l.otherwise || (l.subjectArm && isAbsent(l.subjectArm)));
    const presentLeaf = present ?? r.leaves.find((l) => l.otherwise)!;
    const absentLeaf = absent ?? presentLeaf;
    const binder = present ? binderFor(present, present.subjectArm) : "_";
    const bind = binder !== "_" ? `${binder} = ${subject}; ` : "";
    return `(if ${subject} != nil do ${bind}${leafOutcome(presentLeaf, o)} else ${leafOutcome(absentLeaf, o)} end)`;
  }
  const tagged = m.subject?.kind === "ref" && o.taggedSubjects.has(m.subject.name);
  const clauses = r.leaves.map((leaf) => {
    const arm = leaf.subjectArm;
    if (!arm) return `_ -> ${leafOutcome(leaf, o)}`;
    const binder = binderFor(leaf, arm);
    const unwrap = tagged && !arm.isError && binder !== "_" && isScalarVariant(arm.varType);
    return `${elixirVariantPattern(arm, unwrap ? `%{value: ${binder}}` : binder)} -> ${leafOutcome(leaf, o)}`;
  });
  return `(case ${elixirUnionScrutinee(subject)} do ${clauses.join("; ")} end)`;
}

/** The serializers the responders call: one per aggregate a success arm
 *  answers and one per workflow answering itself, keyed by function name. */
export function entrySerializers(
  results: readonly { r: EntryResult; ctx: BoundedContextIR; wf?: WorkflowIR }[],
): Map<string, string> {
  const fns = new Map<string, string>();
  const add = (s: { serialize: string; helpers: string[] }, name: string): void => {
    if (!fns.has(name)) fns.set(name, s.serialize);
    for (const h of s.helpers) {
      const n = /defp (\w+)\(/.exec(h)?.[1] ?? h;
      if (!fns.has(n)) fns.set(n, h);
    }
  };
  for (const { r, ctx, wf } of results) {
    for (const arm of r.arms) {
      if (arm.kind === "aggregate") {
        const agg = ctx.aggregates.find((a) => a.name === arm.name);
        if (!agg) continue;
        const suffix = `entry_${N.stem(arm.name)}`;
        add(renderWireSerialize(agg, ctx, { nameSuffix: suffix }), `serialize_${suffix}`);
      } else if (arm.kind === "workflow" && wf) {
        add(renderWorkflowInstanceSerialize(wf, ctx), `serialize_${N.stem(wf.name)}`);
      }
    }
  }
  return fns;
}

/** The `<fn>/2` clauses answering an entry outcome: 200 with the tagged
 *  success value, an `error` variant at its mapped status, and anything else
 *  through `fallback`. */
export function renderEntryResponders(
  fn: string,
  fallback: string,
  results: readonly { r: EntryResult; ctx: BoundedContextIR; wf?: WorkflowIR }[],
): string {
  const seen = new Set<string>();
  const clauses: string[] = [];
  for (const { r, ctx, wf } of results) {
    for (const arm of r.arms) {
      const key = `${arm.kind}:${arm.tag}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tag = JSON.stringify(arm.tag);
      switch (arm.kind) {
        case "value":
          clauses.push(
            `  def ${fn}(conn, {:ok, {${tag}, v}}), do: json(conn, %{"type" => ${tag}, "value" => v})`,
          );
          break;
        case "payload":
          clauses.push(
            `  def ${fn}(conn, {:ok, {${tag}, v}}), do: json(conn, Map.put(v, :type, ${tag}))`,
          );
          break;
        case "aggregate":
          clauses.push(
            `  def ${fn}(conn, {:ok, {${tag}, v}}), do: json(conn, Map.put(serialize_entry_${N.stem(arm.name)}(v), "type", ${tag}))`,
          );
          break;
        case "workflow":
          if (wf) {
            clauses.push(
              `  def ${fn}(conn, {:ok, {${tag}, v}}), do: json(conn, Map.put(serialize_${N.stem(wf.name)}(v), "type", ${tag}))`,
            );
          }
          break;
        case "error": {
          const resp = exErrorVariant(arm.tag, ctx.errorStatusOverrides);
          clauses.push(
            `  def ${fn}(conn, {:error, {:variant, ${tag}, data}}),
    do: problem_variant(conn, ${resp.status}, ${elixirString(resp.type)}, ${elixirString(resp.title)}, ${elixirString(errorVariantCode(ctx.name, arm.tag))}, data)`,
          );
          break;
        }
      }
    }
  }
  clauses.push(`  def ${fn}(conn, other), do: ${fallback}(conn, other)`);
  return clauses.join("\n\n");
}
