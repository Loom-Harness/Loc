// The Python half of an expected-failure entry point — a workflow `create`, a
// `commandHandler`, a `queryHandler` whose result is `T or E`
// (`src/ir/util/entry-result.ts`).
//
// The route answers the tagged dict directly: a scalar wraps `value`, a
// payload / error carries its fields beside `type`, an aggregate its
// `repo.to_wire(...)` projection and the workflow its instance row.  The
// request's one session commits only when the response status is below 400
// (`TransactionMiddleware`), so answering an `error` variant at its mapped
// 4xx rolls the whole command back — every write, the error arm's own and the
// writes of the reactors its events ran inline — and the route dispatches the
// workflow's own emits only on success.

import { errorVariantResponse } from "../../ir/enrich/wire-policy.js";
import { isScalarVariant, variantTag } from "../../ir/stdlib/unions.js";
import type { BoundedContextIR, ExprIR, TypeIR, WireField } from "../../ir/types/loom-ir.js";
import {
  type EntryResult,
  type EntryResultLeaf,
  entryErrorTags,
} from "../../ir/util/entry-result.js";
import { walkExprDeep } from "../../ir/util/walk.js";
import { pythonIdent } from "../../util/naming.js";
import { unionMembers } from "../_payload/union-wire.js";
import { PY, pyIdType } from "./py-symbols.js";
import { renderPyType } from "./render-expr.js";
import { pyScalarReturnToWire } from "./routes-builder.js";
import { pyErrorVariantReturn } from "./wire-policy-py.js";

function leafDict(
  leaf: EntryResultLeaf,
  render: (e: ExprIR) => string,
  t: Extract<TypeIR, { kind: "union" }>,
  ctx: BoundedContextIR,
  repoOf: (agg: string) => string,
  selfField: (f: WireField) => string,
  selfShape: readonly WireField[],
  subject?: string,
): string {
  const tag = JSON.stringify(leaf.arm.tag);
  // A `match`-arm binding (`Order v => { return v }`) is the operation's own
  // union dict, not a domain object: its fields are read by key, off the
  // subject itself — rebinding one name to a dict here and to a scalar in a
  // sibling arm is a type error under mypy --strict.
  const bound = isBoundRef(leaf.value);
  const boundDict = subject ?? render(leaf.value);
  switch (leaf.arm.kind) {
    case "value":
      return `{"type": ${tag}, "value": ${pyScalarReturnToWire(render(leaf.value), leaf.arm.type)}}`;
    case "aggregate": {
      // Read back after the body's saves: the saved row carries the version
      // the save advanced to.
      const id = bound
        ? `${PY.cast}(${pyIdType(leaf.arm.name)}, ${boundDict}["id"])`
        : `${render(leaf.value)}.id`;
      return `{"type": ${tag}, **${repoOf(leaf.arm.name)}.to_wire(await ${repoOf(leaf.arm.name)}.get_by_id(${id}))}`;
    }
    case "workflow":
      return `{"type": ${tag}, ${selfShape.map((f) => `"${f.name}": ${selfField(f)}`).join(", ")}}`;
    case "payload":
    case "error": {
      const member = unionMembers(t.variants, ctx).find((m) => m.tag === leaf.arm.tag);
      const fields = member?.shape === "record" ? member.fields : [];
      const obj = leaf.value.kind === "object" ? leaf.value.fields : [];
      const parts = bound
        ? fields.map(
            (f) =>
              `"${f.name}": ${pyScalarReturnToWire(`${boundDict}["${f.name}"]`, f.type)}`,
          )
        : fields.flatMap((f) => {
            const v = obj.find((o) => o.name === f.name);
            return v ? [`"${f.name}": ${pyScalarReturnToWire(render(v.value), f.type)}`] : [];
          });
      return `{"type": ${tag}${parts.length > 0 ? `, ${parts.join(", ")}` : ""}}`;
    }
  }
}

const isBoundRef = (e: ExprIR): boolean => e.kind === "ref" && e.refKind === "match-binding";

const reads = (e: ExprIR, name: string): boolean => {
  let hit = false;
  walkExprDeep(e, (x) => {
    if (x.kind === "ref" && x.name === name) hit = true;
  });
  return hit;
};

/** Assign `target` from the result's leaves: the tail value, or a re-dispatch
 *  on the terminal `match`'s subject whose arms bind as the statement `match`
 *  did (an arm binds only when its value reads the binding — ruff F841). */
export function entryResultPyLines(
  er: EntryResult,
  t: Extract<TypeIR, { kind: "union" }>,
  render: (e: ExprIR) => string,
  ctx: BoundedContextIR,
  indent: string,
  target: string,
  repoOf: (agg: string) => string,
  selfField: (f: WireField) => string = () => "None",
  selfShape: readonly WireField[] = [],
): string[] {
  const assign = (leaf: EntryResultLeaf, pad: string, subject?: string) =>
    `${pad}${target} = ${leafDict(leaf, render, t, ctx, repoOf, selfField, selfShape, subject)}`;
  const out = [`${indent}${target}: dict[str, object] = {}`];
  const m = er.match;
  if (!m?.subject) return [...out, ...er.leaves.map((l) => assign(l, indent))];
  const subject = render(m.subject);
  if (m.subjectShape === "absence") {
    const present = er.leaves.find(
      (l) => l.subjectArm && l.subjectArm.varType.kind !== "none" && !l.subjectArm.isError,
    );
    const absent = er.leaves.find((l) => l !== present);
    out.push(`${indent}if ${subject} is not None:`);
    out.push(present ? assign(present, `${indent}    `) : `${indent}    pass`);
    if (absent) out.push(`${indent}else:`, assign(absent, `${indent}    `));
    return out;
  }
  let first = true;
  for (const leaf of er.leaves) {
    const arm = leaf.subjectArm;
    if (!arm) {
      out.push(`${indent}else:`, assign(leaf, `${indent}    `));
      continue;
    }
    const scalar = isScalarVariant(arm.varType);
    const value = scalar ? `${PY.cast}(${renderPyType(arm.varType)}, ${subject}["value"])` : subject;
    // A dict arm answering its binding reads the subject directly.
    const direct = !scalar && isBoundRef(leaf.value);
    out.push(
      `${indent}${first ? "if" : "elif"} ${subject}["type"] == ${JSON.stringify(variantTag(arm.varType))}:`,
      ...(arm.binding && reads(leaf.value, arm.binding) && !direct
        ? [`${indent}    ${pythonIdent(arm.binding)} = ${value}`]
        : []),
      assign(leaf, `${indent}    `, direct ? subject : undefined),
    );
    first = false;
  }
  return out;
}

/** Answer an error variant at its mapped status as problem+json; the 4xx is
 *  what rolls the request's transaction back. */
export function entryErrorPyLines(
  er: EntryResult,
  ctx: BoundedContextIR,
  v: string,
  jsonResponseRef: string,
  indent: string,
): string[] {
  return entryErrorTags(er).flatMap((tag) => [
    `${indent}if ${v}["type"] == ${JSON.stringify(tag)}:`,
    ...pyErrorVariantReturn({
      tag,
      overrides: ctx.errorStatusOverrides,
      jsonResponseRef,
      bodyHead: `**${v}, `,
      indent: `${indent}    `,
    }),
  ]);
}

/** The statuses the error arms answer. */
export function entryErrorStatusesPy(er: EntryResult, ctx: BoundedContextIR): number[] {
  return [...new Set(entryErrorTags(er).map((tag) => errorVariantStatus(tag, ctx)))];
}

const errorVariantStatus = (tag: string, ctx: BoundedContextIR): number =>
  errorVariantResponse(tag, ctx.errorStatusOverrides).status;
