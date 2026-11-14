// The .NET half of an expected-failure entry point — a workflow `create`, a
// `commandHandler`, a `queryHandler` whose result is `T or E`
// (`src/ir/util/entry-result.ts`).
//
// The handler answers the wire union directly: one
// `[JsonPolymorphic]` record family per result union under
// `Application.EntryResults`, each success arm built from its value (a payload
// field by field, an aggregate through `projectEntityArgs`, the workflow's
// instance state through its `InstanceResponse` projection).  The handler runs
// in one transaction; an `error` answer rolls it back and leaves the deferred
// aggregate events unflushed.  The controller answers an error record as
// problem+json at the arm's mapped status, and any other record at 200
// through the union base (the base is what writes the `type` tag).

import { errorVariantResponse } from "../../ir/enrich/wire-policy.js";
import { isScalarVariant, unionInstanceName, variantTag } from "../../ir/stdlib/unions.js";
import type {
  EnrichedAggregateIR,
  EnrichedBoundedContextIR,
  ExprIR,
  TypeIR,
} from "../../ir/types/loom-ir.js";
import {
  type EntryResult,
  type EntryResultLeaf,
  entryErrorTags,
} from "../../ir/util/entry-result.js";
import { lines } from "../../util/code-builder.js";
import { RFC7807_MEMBERS, type UnionMember, unionMembers } from "../_payload/union-wire.js";
import { DOMAIN_NAMES } from "../_symbols/plan.js";
import { dtoParam, projectEntityArgs, projectToResponse, wireType } from "./dto-mapping.js";
import { renderUnionRecordFamily, splitUnionSuccessTags } from "./union-records.js";
import { csErrorVariantExt } from "./wire-policy-cs.js";

/** The namespace the entry-result unions live in. */
export const entryResultNs = (ns: string): string => `${ns}.Application.EntryResults`;

/** The union record family's base name (`ReceiptOrPaymentDeclined`). */
export function entryUnionName(t: TypeIR): string {
  return t.kind === "union" ? unionInstanceName(t.variants) : "";
}

/** `Application/EntryResults/<Union>.cs` — the base and one record per arm. */
export function renderEntryUnionFile(
  t: Extract<TypeIR, { kind: "union" }>,
  ctx: EnrichedBoundedContextIR,
  ns: string,
): { path: string; content: string } {
  const name = entryUnionName(t);
  const members = unionMembers(t.variants, ctx);
  const params = (m: UnionMember): string => {
    if (m.shape === "none") return "";
    if (m.shape === "scalar") return dtoParam(wireType(m.type, ctx, "response"), "Value");
    return m.fields
      .map((f) =>
        dtoParam(
          wireType(
            f.optional && f.type.kind !== "optional" ? { kind: "optional", inner: f.type } : f.type,
            ctx,
            "response",
          ),
          DOMAIN_NAMES.csharp.prop(f.name),
        ),
      )
      .join(", ");
  };
  return {
    path: `Application/EntryResults/${name}.cs`,
    content: lines(
      "// Auto-generated.",
      "using System;",
      "using System.Collections.Generic;",
      "using System.ComponentModel.DataAnnotations;",
      "using System.Text.Json.Serialization;",
      `using ${ns}.Domain.Enums;`,
      "",
      `namespace ${entryResultNs(ns)};`,
      "",
      ...renderUnionRecordFamily(
        name,
        members.map((m) => m.tag),
        (tag) => params(members.find((m) => m.tag === tag)!),
        splitUnionSuccessTags(t.variants, ctx),
      ),
      "",
    ),
  };
}

/** The record one answered value builds. */
function leafCtor(
  leaf: EntryResultLeaf,
  render: (e: ExprIR) => string,
  t: Extract<TypeIR, { kind: "union" }>,
  ctx: EnrichedBoundedContextIR,
  ns: string,
  selfVar: string,
  repoOf: ((aggName: string) => string | undefined) | undefined,
): string {
  const name = entryUnionName(t);
  const rec = `global::${entryResultNs(ns)}.${name}_${leaf.arm.tag}`;
  const rendered = render(leaf.value);
  const member = unionMembers(t.variants, ctx).find((m) => m.tag === leaf.arm.tag);
  // A `match`-arm binding (`Order v => { return v }`) is the operation's own
  // union record, built inside the domain method: its id is the raw `Guid`
  // and its fields are wire-shaped.  The aggregate is re-read by that id; a
  // payload / error record is read through its properties.
  const bound = leaf.value.kind === "ref" && leaf.value.refKind === "match-binding";
  switch (leaf.arm.kind) {
    case "value":
      return `new ${rec}(${projectToResponse(rendered, leaf.arm.type, ctx)})`;
    case "aggregate": {
      const agg = ctx.aggregates.find((a) => a.name === leaf.arm.tag) as EnrichedAggregateIR;
      const repo = bound ? repoOf?.(agg.name) : undefined;
      if (repo) {
        // One read, bound once: `is var` always matches.
        const read = `(await ${repo}.GetByIdAsync(new global::${ns}.Domain.Ids.${agg.name}Id(${rendered}.Id), cancellationToken))!`;
        return `(${read} is var __saved ? new ${rec}(${projectEntityArgs("__saved", agg, ctx, { unionVariant: true })}) : default!)`;
      }
      return `new ${rec}(${projectEntityArgs(rendered, agg, ctx, { unionVariant: true })})`;
    }
    case "workflow": {
      const fields = member?.shape === "record" ? member.fields : [];
      return `new ${rec}(${fields.map((f) => projectToResponse(`${selfVar}.${DOMAIN_NAMES.csharp.prop(f.name)}`, f.type, ctx)).join(", ")})`;
    }
    case "payload":
    case "error": {
      const fields = member?.shape === "record" ? member.fields : [];
      if (bound) {
        return `new ${rec}(${fields.map((f) => `${rendered}.${DOMAIN_NAMES.csharp.prop(f.name)}`).join(", ")})`;
      }
      const obj = leaf.value.kind === "object" ? leaf.value.fields : [];
      return `new ${rec}(${fields
        .map((f) => {
          const v = obj.find((o) => o.name === f.name);
          return v ? projectToResponse(render(v.value), f.type, ctx) : "default!";
        })
        .join(", ")})`;
    }
  }
}

/** Assign `target` from the result's leaves: the tail value, or a re-dispatch
 *  on the terminal `match`'s subject whose arms bind as the statement `match`
 *  did.  A `notFound` arm answered already, so it has no case. */
export function entryResultCsLines(
  er: EntryResult,
  t: Extract<TypeIR, { kind: "union" }>,
  render: (e: ExprIR) => string,
  ctx: EnrichedBoundedContextIR,
  ns: string,
  indent: string,
  target: string,
  selfVar = "state",
  /** The injected repository field for an aggregate, so a bound aggregate arm
   *  is re-read after the body's saves. */
  repoOf?: (aggName: string) => string | undefined,
): string[] {
  const assign = (leaf: EntryResultLeaf, pad: string) =>
    `${pad}${target} = ${leafCtor(leaf, render, t, ctx, ns, selfVar, repoOf)};`;
  const m = er.match;
  if (!m?.subject) return er.leaves.map((l) => assign(l, indent));
  const subject = render(m.subject);
  const out: string[] = [];
  if (m.subjectShape === "absence") {
    const present = er.leaves.find(
      (l) => l.subjectArm && l.subjectArm.varType.kind !== "none" && !l.subjectArm.isError,
    );
    const absent = er.leaves.find((l) => l !== present);
    out.push(`${indent}if (${subject} is not null)`, `${indent}{`);
    if (present) out.push(assign(present, `${indent}    `));
    out.push(`${indent}}`);
    if (absent)
      out.push(`${indent}else`, `${indent}{`, assign(absent, `${indent}    `), `${indent}}`);
    return out;
  }
  const subjectUnion =
    m.subjectType?.kind === "union" ? unionInstanceName(m.subjectType.variants) : "";
  out.push(`${indent}switch (${subject})`, `${indent}{`);
  for (const leaf of er.leaves) {
    const arm = leaf.subjectArm;
    const inner = `${indent}        `;
    if (!arm) {
      out.push(
        `${indent}    default:`,
        `${indent}    {`,
        assign(leaf, inner),
        `${inner}break;`,
        `${indent}    }`,
      );
      continue;
    }
    const carrier = `${subjectUnion}_${variantTag(arm.varType)}`;
    const label = !arm.binding
      ? `case ${carrier}:`
      : isScalarVariant(arm.varType)
        ? `case ${carrier} __${arm.binding}Carrier:`
        : `case ${carrier} ${DOMAIN_NAMES.csharp.binding(arm.binding)}:`;
    out.push(`${indent}    ${label}`, `${indent}    {`);
    if (arm.binding && isScalarVariant(arm.varType)) {
      out.push(
        `${inner}var ${DOMAIN_NAMES.csharp.binding(arm.binding)} = __${arm.binding}Carrier.Value;`,
      );
    }
    out.push(assign(leaf, inner), `${inner}break;`, `${indent}    }`);
  }
  out.push(`${indent}}`);
  return out;
}

/** The C# test that `v` holds an `error` record. */
export function entryErrorTestCs(er: EntryResult, t: TypeIR, ns: string, v: string): string {
  const name = entryUnionName(t);
  return `${v} is ${entryErrorTags(er)
    .map((tag) => `global::${entryResultNs(ns)}.${name}_${tag}`)
    .join(" or ")}`;
}

/** The controller's answer: an error record as problem+json at its mapped
 *  status (its fields as RFC 7807 extension members), anything else at 200
 *  through the union base. */
export function entryControllerAnswer(
  er: EntryResult,
  t: Extract<TypeIR, { kind: "union" }>,
  ctx: EnrichedBoundedContextIR,
  ns: string,
  v: string,
  indent: string,
): string[] {
  const name = entryUnionName(t);
  const base = `global::${entryResultNs(ns)}.${name}`;
  const members = unionMembers(t.variants, ctx);
  const out = [`${indent}switch (${v})`, `${indent}{`];
  for (const tag of entryErrorTags(er)) {
    const r = errorVariantResponse(tag, ctx.errorStatusOverrides);
    const d = errorVariantResponse(tag);
    const m = members.find((mm) => mm.tag === tag);
    // Every field rides `params`; only those not named like a problem member
    // (`code`, `params`, …) also ride as extension members, where the problem
    // member would overwrite them.
    const allFields = m?.shape === "record" ? m.fields : [];
    const fields = allFields.filter((f) => !RFC7807_MEMBERS.has(f.name));
    out.push(
      `${indent}    case ${base}_${tag} ${allFields.length > 0 ? "__e" : "_"}:`,
      `${indent}    {`,
      `${indent}        var problem = new Microsoft.AspNetCore.Mvc.ProblemDetails { Status = ${r.status}, Title = ${JSON.stringify(d.title)}, Type = ${JSON.stringify(d.type)}, Detail = ${JSON.stringify(d.detail)}, Instance = HttpContext.Request.Path };`,
      ...fields.map(
        (f) =>
          `${indent}        problem.Extensions[${JSON.stringify(f.name)}] = __e.${DOMAIN_NAMES.csharp.prop(f.name)};`,
      ),
      ...csErrorVariantExt(
        ctx,
        tag,
        "problem",
        allFields.map((f) => ({
          json: f.name,
          accessor: `__e.${DOMAIN_NAMES.csharp.prop(f.name)}`,
        })),
        `${indent}        `,
      ),
      `${indent}        return new ObjectResult(problem) { StatusCode = ${r.status}, ContentTypes = { "application/problem+json" } };`,
      `${indent}    }`,
    );
  }
  out.push(
    `${indent}    default:`,
    `${indent}        return new ObjectResult(${v}) { StatusCode = 200, DeclaredType = typeof(${base}) };`,
    `${indent}}`,
  );
  return out;
}

/** The statuses the error arms answer, for `[ProducesResponseType]`. */
export function entryErrorStatuses(er: EntryResult, ctx: EnrichedBoundedContextIR): number[] {
  return [
    ...new Set(
      entryErrorTags(er).map((tag) => errorVariantResponse(tag, ctx.errorStatusOverrides).status),
    ),
  ].sort((a, b) => a - b);
}
