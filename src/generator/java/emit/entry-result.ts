// The Java half of an expected-failure entry point — a workflow `create`, a
// `commandHandler`, a `queryHandler` whose result is `T or E`
// (`src/ir/util/entry-result.ts`).
//
// The service answers the wire union directly: the Jackson-polymorphic
// `<Union>Response` family `renderJavaUnionWireFiles` renders for an operation's
// union, each success arm built from its value (a payload field by field, an
// aggregate and the workflow's instance state through their accessors).  The
// service is `@Transactional`; an `error` answer marks the transaction
// rollback-only before it returns, so every write the command made — the
// error arm's included — is discarded, and the events it published reach no
// `AFTER_COMMIT` listener.  The controller answers an error record as
// problem+json at its mapped status and any other record at 200.

import { errorVariantResponse } from "../../../ir/enrich/wire-policy.js";
import { isScalarVariant, unionInstanceName, variantTag } from "../../../ir/stdlib/unions.js";
import type { BoundedContextIR, ExprIR, TypeIR } from "../../../ir/types/loom-ir.js";
import {
  type EntryResult,
  type EntryResultLeaf,
  entryErrorTags,
} from "../../../ir/util/entry-result.js";
import { RFC7807_MEMBERS, unionMembers } from "../../_payload/union-wire.js";
import { DOMAIN_NAMES } from "../../_symbols/plan.js";
import { javaErrorVariantExt } from "../wire-policy-java.js";
import { type JavaReturnUnionSpec, renderJavaUnionWireFiles, type UnionFile } from "./unions.js";
import { domainToWire } from "./wire.js";

/** The wire union's interface name (`ReceiptOrPaymentDeclinedResponse`). */
export function entryUnionJava(t: TypeIR): string {
  return t.kind === "union" ? `${unionInstanceName(t.variants)}Response` : "";
}

/** The wire union files for an entry result. */
export function entryUnionFiles(
  t: Extract<TypeIR, { kind: "union" }>,
  ctx: BoundedContextIR,
  pkg: string,
  basePkg: string,
): UnionFile[] {
  const members = unionMembers(t.variants, ctx);
  const errors = new Set(ctx.payloads.filter((p) => p.kind === "error").map((p) => p.name));
  const spec: JavaReturnUnionSpec = {
    name: unionInstanceName(t.variants),
    members,
    arms: members.map((m) => ({ tag: m.tag, member: m, isError: errors.has(m.tag) })),
  };
  return renderJavaUnionWireFiles(spec, pkg, basePkg);
}

function leafCtor(
  leaf: EntryResultLeaf,
  rendered: string,
  render: (e: ExprIR) => string,
  t: Extract<TypeIR, { kind: "union" }>,
  ctx: BoundedContextIR,
  selfVar: string,
  repoOf: ((aggName: string) => string) | undefined,
): string {
  const rec = `${entryUnionJava(t)}_${leaf.arm.tag}`;
  // A `match`-arm binding (`Order v => { return v }`) is the operation's own
  // union carrier, captured inside the domain method — before the save.  The
  // aggregate is re-read so the answer carries the version the save advanced
  // to; a payload / error carrier is read through its accessors.
  const bound = leaf.value.kind === "ref" && leaf.value.refKind === "match-binding";
  const member = unionMembers(t.variants, ctx).find((m) => m.tag === leaf.arm.tag);
  const fields = member?.shape === "record" ? member.fields : [];
  const eff = (ft: TypeIR, optional: boolean): TypeIR =>
    optional && ft.kind !== "optional" ? { kind: "optional", inner: ft } : ft;
  switch (leaf.arm.kind) {
    case "value":
      return `new ${rec}(${domainToWire(leaf.arm.type, rendered)})`;
    case "aggregate": {
      const src = bound && repoOf ? `${repoOf(leaf.arm.name)}.getById(${rendered}.id())` : rendered;
      return `new ${rec}(${fields.map((f) => domainToWire(eff(f.type, f.optional), `${src}.${DOMAIN_NAMES.java.prop(f.name)}()`)).join(", ")})`;
    }
    case "workflow":
      return `new ${rec}(${fields.map((f) => domainToWire(eff(f.type, f.optional), `${selfVar}.${DOMAIN_NAMES.java.prop(f.name)}()`)).join(", ")})`;
    case "payload":
    case "error": {
      if (bound) {
        return `new ${rec}(${fields.map((f) => domainToWire(eff(f.type, f.optional), `${rendered}.${DOMAIN_NAMES.java.prop(f.name)}()`)).join(", ")})`;
      }
      const obj = leaf.value.kind === "object" ? leaf.value.fields : [];
      return `new ${rec}(${fields
        .map((f) => {
          const v = obj.find((o) => o.name === f.name);
          return v ? domainToWire(eff(f.type, f.optional), render(v.value)) : "null";
        })
        .join(", ")})`;
    }
  }
}

/** Assign `target` from the result's leaves: the tail value, or a re-dispatch
 *  on the terminal `match`'s subject whose arms bind as the statement `match`
 *  did.  A `notFound` arm answered already; the pattern switch's `default`
 *  covers it. */
export function entryResultJavaLines(
  er: EntryResult,
  t: Extract<TypeIR, { kind: "union" }>,
  render: (e: ExprIR) => string,
  bound: (name: string) => string,
  carrierOf: (unionName: string, tag: string) => string,
  ctx: BoundedContextIR,
  indent: string,
  target: string,
  selfVar = "state",
  /** The repository field for an aggregate, so a bound aggregate arm is read
   *  back after the save. */
  repoOf?: (aggName: string) => string,
): string[] {
  const assign = (leaf: EntryResultLeaf, pad: string) =>
    `${pad}${target} = ${leafCtor(leaf, render(leaf.value), render, t, ctx, selfVar, repoOf)};`;
  const m = er.match;
  if (!m?.subject) return er.leaves.map((l) => assign(l, indent));
  const subject = render(m.subject);
  if (m.subjectShape === "absence") {
    const present = er.leaves.find(
      (l) => l.subjectArm && l.subjectArm.varType.kind !== "none" && !l.subjectArm.isError,
    );
    const absent = er.leaves.find((l) => l !== present);
    const out = [`${indent}if (${subject} != null) {`];
    if (present) out.push(assign(present, `${indent}    `));
    if (absent) out.push(`${indent}} else {`, assign(absent, `${indent}    `));
    out.push(`${indent}}`);
    return out;
  }
  const unionName =
    m.subjectType?.kind === "union" ? unionInstanceName(m.subjectType.variants) : "";
  const inner = `${indent}        `;
  const out = [`${indent}switch (${subject}) {`];
  let hasDefault = false;
  er.leaves.forEach((leaf, i) => {
    const arm = leaf.subjectArm;
    if (!arm) {
      hasDefault = true;
      out.push(`${indent}    default -> {`, assign(leaf, inner), `${indent}    }`);
      return;
    }
    const scalar = isScalarVariant(arm.varType);
    const binder =
      arm.binding && !scalar
        ? bound(arm.binding)
        : arm.binding
          ? `${DOMAIN_NAMES.java.binding(arm.binding)}Carrier`
          : `unusedResultArm${i}`;
    out.push(
      `${indent}    case ${carrierOf(unionName, variantTag(arm.varType))} ${binder} -> {`,
      ...(arm.binding && scalar ? [`${inner}var ${bound(arm.binding)} = ${binder}.value();`] : []),
      assign(leaf, inner),
      `${indent}    }`,
    );
  });
  if (!hasDefault) out.push(`${indent}    default -> { }`);
  out.push(`${indent}}`);
  return out;
}

/** The Java test that `v` holds an `error` record. */
export function entryErrorTestJava(er: EntryResult, t: TypeIR, v: string): string {
  return entryErrorTags(er)
    .map((tag) => `${v} instanceof ${entryUnionJava(t)}_${tag}`)
    .join(" || ");
}

/** The controller's answer for an entry result held in `v`: each error record
 *  as problem+json at its mapped status, anything else at 200. */
export function entryControllerJava(
  er: EntryResult,
  t: Extract<TypeIR, { kind: "union" }>,
  ctx: BoundedContextIR,
  v: string,
  indent: string,
  refs: { problemDetail: string; uri: string; mediaType: string; responseEntity: string },
): string[] {
  const members = unionMembers(t.variants, ctx);
  const out: string[] = [];
  for (const tag of entryErrorTags(er)) {
    const r = errorVariantResponse(tag, ctx.errorStatusOverrides);
    const d = errorVariantResponse(tag);
    const m = members.find((mm) => mm.tag === tag);
    const fields =
      m?.shape === "record" ? m.fields.filter((f) => !RFC7807_MEMBERS.has(f.name)) : [];
    out.push(
      `${indent}if (${v} instanceof ${entryUnionJava(t)}_${tag} __e) {`,
      `${indent}    var problem = ${refs.problemDetail}.forStatus(${r.status});`,
      `${indent}    problem.setTitle(${JSON.stringify(d.title)});`,
      `${indent}    problem.setType(${refs.uri}.create(${JSON.stringify(d.type)}));`,
      `${indent}    problem.setDetail(${JSON.stringify(d.detail)});`,
      ...fields.map(
        (f) =>
          `${indent}    problem.setProperty(${JSON.stringify(f.name)}, __e.${DOMAIN_NAMES.java.prop(f.name)}());`,
      ),
      ...javaErrorVariantExt(
        ctx,
        tag,
        `${indent}    `,
        (name) => `__e.${DOMAIN_NAMES.java.prop(name)}()`,
      ),
      `${indent}    return ${refs.responseEntity}.status(${r.status}).contentType(${refs.mediaType}.APPLICATION_PROBLEM_JSON).body(problem);`,
      `${indent}}`,
    );
  }
  out.push(`${indent}return ${refs.responseEntity}.ok(${v});`);
  return out;
}
