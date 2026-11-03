// The answered value of a routed command entry point — a workflow `create`, a
// `commandHandler`, a `queryHandler` — whose result declares an expected
// failure (`T or E`).
//
// Lowering hands every backend the same three facts: the declared union
// (`returnType`), the answered value (`returnValue` — the tail `return`'s
// expression, or a value `match` over the subject of the body's terminal
// statement `match`), and the declared variant each answered value produces
// (`returnTags`).  This module joins them into the leaves a backend renders:
// each leaf is one answered value, the subject arm it is answered in (when the
// value is a `match`), and how the variant it produces travels on the wire.
//
// Every backend runs such an entry point in ONE transaction and, when the
// answered value is an `error` variant, rolls the whole command back — the
// aggregates it saved, the saga row, outbox / audit / provenance rows and the
// error arm's own writes — and dispatches no event (D-FAILURE-MODEL).  The
// route then answers the error at its mapped status as problem+json, exactly
// as an operation's `or E` result.

import { variantTag } from "../stdlib/unions.js";
import type { BoundedContextIR, ExprIR, TypeIR } from "../types/loom-ir.js";

/** How one declared variant of an entry point's result travels on the wire. */
export type EntryResultArm =
  /** An `X id` or a scalar: `{ type, value }`. */
  | { kind: "value"; tag: string; type: TypeIR }
  /** A payload record: its fields beside `type`. */
  | { kind: "payload"; tag: string; name: string }
  /** An aggregate: its `<Agg>Response` fields beside `type`. */
  | { kind: "aggregate"; tag: string; name: string }
  /** The create's own workflow (`return this`): its instance state, in the
   *  `<Wf>InstanceResponse` shape, beside `type`. */
  | { kind: "workflow"; tag: string; name: string }
  /** An `error` payload: answered as problem+json at its mapped status. */
  | { kind: "error"; tag: string; name: string };

/** One answered value. */
export interface EntryResultLeaf {
  value: ExprIR;
  arm: EntryResultArm;
  /** The subject arm the value is answered in, when `returnValue` is a value
   *  `match` — absent for the `otherwise` arm and for a tail `return`. */
  subjectArm?: Extract<ExprIR, { kind: "match" }>["variantArms"][number];
  /** True for the value of the `match`'s `else`. */
  otherwise?: boolean;
}

export interface EntryResult {
  /** The declared union's variants, classified, in source order. */
  arms: EntryResultArm[];
  /** The value `match` the leaves are the arms of; absent for a tail return. */
  match?: Extract<ExprIR, { kind: "match" }>;
  leaves: EntryResultLeaf[];
}

type EntryOwner = { returnType?: TypeIR; returnValue?: ExprIR; returnTags?: string[] };

/** Classify one declared variant. */
function entryResultArm(t: TypeIR, ctx: BoundedContextIR): EntryResultArm {
  const tag = variantTag(t);
  if (t.kind === "entity") {
    const payload = ctx.payloads.find((p) => p.name === t.name);
    if (payload?.kind === "error") return { kind: "error", tag, name: t.name };
    if (payload) return { kind: "payload", tag, name: t.name };
    if (ctx.aggregates.some((a) => a.name === t.name))
      return { kind: "aggregate", tag, name: t.name };
    if (ctx.workflows.some((w) => w.name === t.name))
      return { kind: "workflow", tag, name: t.name };
  }
  return { kind: "value", tag, type: t };
}

/** True when `owner`'s declared result is a union with an `error` variant. */
function declaresEntryFailure(owner: EntryOwner, ctx: BoundedContextIR): boolean {
  const t = owner.returnType;
  return t?.kind === "union" && t.variants.some((v) => entryResultArm(v, ctx).kind === "error");
}

/** True when a routed `commandHandler` / `queryHandler` of `ctx` answers an
 *  expected failure — it then runs in a unit-of-work transaction the backend
 *  must provide, exactly as a workflow does. */
export function answersEntryResults(ctx: BoundedContextIR): boolean {
  return [...(ctx.commandHandlers ?? []), ...(ctx.queryHandlers ?? [])].some(
    (h) => !h.extern && entryResult(h, ctx) !== undefined,
  );
}

/** The leaves of an expected-failure result, or undefined when `owner` does
 *  not declare one (or has no answered value — an `extern` handler). */
export function entryResult(owner: EntryOwner, ctx: BoundedContextIR): EntryResult | undefined {
  const t = owner.returnType;
  if (t?.kind !== "union" || !declaresEntryFailure(owner, ctx)) return undefined;
  const arms = t.variants.map((v) => entryResultArm(v, ctx));
  const value = owner.returnValue;
  const tags = owner.returnTags ?? [];
  if (!value) return { arms, leaves: [] };
  const armOf = (tag: string | undefined): EntryResultArm =>
    arms.find((a) => a.tag === tag) ?? arms[0]!;
  const desugared =
    value.kind === "match" &&
    value.subject !== undefined &&
    value.variantArms.length > 0 &&
    tags.length === value.variantArms.length + (value.otherwise ? 1 : 0);
  if (value.kind === "match" && desugared) {
    const leaves: EntryResultLeaf[] = value.variantArms.map((a, i) => ({
      value: a.value,
      arm: armOf(tags[i]),
      subjectArm: a,
    }));
    if (value.otherwise) {
      leaves.push({
        value: value.otherwise,
        arm: armOf(tags[value.variantArms.length]),
        otherwise: true,
      });
    }
    return { arms, match: value, leaves };
  }
  return { arms, leaves: [{ value, arm: armOf(tags[0]) }] };
}

/** The tags of the declared `error` variants. */
export function entryErrorTags(r: EntryResult): string[] {
  return r.arms.filter((a) => a.kind === "error").map((a) => a.tag);
}
