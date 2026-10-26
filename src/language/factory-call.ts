// The argument mapping of an aggregate factory call `Agg.create(…)`.
//
// An aggregate's `create` is a lifecycle method, called like any other method
// in one of two shapes, and both mean one record keyed by field name — the
// factory's input on every backend:
//
//   Survey.create(e.ticket, e.note)            positional
//   Survey.create(ticket: e.ticket, note: n)   named
//
// The record form `Survey.create({ ticket: … })` leaked the create-command
// wire record into the domain language and is refused
// (`loom.create-record-form`, D-CREATE-CALL-STYLE).
//
// A positional list maps onto the aggregate's create input IN ORDER: the
// parameters of its unnamed `create(…)` when the author declares one (they ARE
// the input's fields), else its properties minus the server-owned ones
// (`managed` / `token` / `internal`) — which is also what the create `with
// crudish` synthesizes takes.  Trailing inputs may be left out; the missing-required-field
// gate decides whether that is allowed.
//
// Shared by the phase-④ argument check (`validators/create-args.ts`), the
// field gates (`validators/builder-call.ts`) and the lowerings
// (`ir/lower/lower-workflow.ts`, `ir/lower/lower-expr.ts`), so the order the
// validator accepts is the order the lowering assigns.

import { type AstNode, AstUtils } from "langium";
import {
  type Aggregate,
  type CallArg,
  type Expression,
  isAggregate,
  isBoundedContext,
  isCreate,
  isMemberSuffix,
  isModel,
  isNameRef,
  isObjectLit,
  isPostfixChain,
  isProperty,
  type MemberSuffix,
  type Parameter,
  type PostfixChain,
} from "./generated/ast.js";
import { originOf } from "./macro-origin.js";

const SERVER_OWNED: ReadonlySet<string> = new Set(["managed", "token", "internal"]);

/** The parameters of the aggregate's unnamed `create(…)` when the author
 *  declares one with parameters: they ARE the create input.  A macro-emitted
 *  create (`with crudish`) narrows nothing — the input stays the full writable
 *  field set, capability fields included — exactly as `declaredCreateParamNames`
 *  (`ir/enrich/wire-projection.ts`) decides for the emitted factory. */
export function declaredCreateParams(agg: Aggregate): readonly Parameter[] | undefined {
  const declared = agg.members.find((m) => isCreate(m) && !m.name);
  if (!declared || !isCreate(declared) || declared.params.length === 0) return undefined;
  return originOf(declared) ? undefined : declared.params;
}

/** The input field names a factory call's positional / named arguments bind
 *  to, in order. */
export function factoryInputNames(agg: Aggregate): string[] {
  const declared = declaredCreateParams(agg);
  return declared ? declared.map((p) => p.name) : factoryInputFieldNames(agg);
}

/** The aggregate's client-writable properties — its create input when it
 *  declares no `create(…)` parameters. */
export function factoryInputFieldNames(agg: Aggregate): string[] {
  const names: string[] = [];
  for (const m of agg.members) {
    if (!isProperty(m)) continue;
    const access = typeof m.access === "string" ? m.access : "";
    if (!SERVER_OWNED.has(access)) names.push(m.name);
  }
  return names;
}

export type FactoryArgs =
  | { kind: "fields"; fields: { name: string; value: Expression }[] }
  | { kind: "mixed" }
  | { kind: "arity"; given: number; inputs: readonly string[] }
  | { kind: "unknown-name"; name: string; inputs: readonly string[] }
  | { kind: "duplicate"; name: string };

/** True for the retired record form: one positional object-literal argument. */
export function isRecordFormCreate(args: readonly CallArg[]): boolean {
  const only = args.length === 1 ? args[0] : undefined;
  return !!only && !only.name && isObjectLit(only.value);
}

/** The aggregate an `Agg.create(…)` chain constructs, with its call suffix, or
 *  `undefined` when the chain is no factory call: `api.orders.create(…)` in a
 *  `test e2e` body has a member receiver, and a name that is no aggregate
 *  calls some other `create`.  The enclosing context's aggregates win; a body
 *  outside any context resolves model-wide. */
export function factoryCallOf(
  node: AstNode,
): { chain: PostfixChain; agg: Aggregate; call: MemberSuffix } | undefined {
  if (!isPostfixChain(node) || !isNameRef(node.head)) return undefined;
  const first = node.suffixes[0];
  if (!first || !isMemberSuffix(first) || !first.call || first.member !== "create") {
    return undefined;
  }
  const name = node.head.name;
  const ctx = AstUtils.getContainerOfType(node, isBoundedContext);
  const local = ctx?.members.find((m) => isAggregate(m) && m.name === name);
  if (local && isAggregate(local)) return { chain: node, agg: local, call: first };
  if (ctx) return undefined;
  const model = AstUtils.getContainerOfType(node, isModel);
  if (!model) return undefined;
  for (const c of AstUtils.streamAllContents(model)) {
    if (!isBoundedContext(c)) continue;
    const agg = c.members.find((m) => isAggregate(m) && m.name === name);
    if (agg && isAggregate(agg)) return { chain: node, agg, call: first };
  }
  return undefined;
}

/** Map a factory call's positional / named arguments onto field names. */
export function factoryArgs(agg: Aggregate, args: readonly CallArg[]): FactoryArgs {
  const inputs = factoryInputNames(agg);
  const named = args.filter((a) => a.name);
  if (named.length > 0 && named.length < args.length) return { kind: "mixed" };
  if (named.length === 0) {
    if (args.length > inputs.length) return { kind: "arity", given: args.length, inputs };
    return { kind: "fields", fields: args.map((a, i) => ({ name: inputs[i]!, value: a.value })) };
  }
  const seen = new Set<string>();
  const fields: { name: string; value: Expression }[] = [];
  for (const a of args) {
    const name = String(a.name);
    if (!inputs.includes(name)) return { kind: "unknown-name", name, inputs };
    if (seen.has(name)) return { kind: "duplicate", name };
    seen.add(name);
    fields.push({ name, value: a.value });
  }
  // Named arguments keep the order they are written in: they are evaluated in
  // that order, and the record-form calls the codemod rewrote into named ones
  // must emit what they emitted before.  The record they build is keyed by
  // name, so the order is a rendering, never a binding.
  return { kind: "fields", fields };
}

/** The record a lowering builds for a factory call's arguments, or `undefined`
 *  when they name no record (the retired record form, a mixed or over-long
 *  argument list, a repeated name — all refused at phase ④).  A named argument
 *  that is not an input still lands in the record under its own name: the
 *  phase-④ field gates refuse it at the call, and the IR checks read the same
 *  record the factory would have been handed. */
export function factoryRecordFields(
  agg: Aggregate,
  args: readonly CallArg[],
): { name: string; value: Expression }[] | undefined {
  if (isRecordFormCreate(args)) return undefined;
  const mapped = factoryArgs(agg, args);
  if (mapped.kind === "fields") return mapped.fields;
  if (mapped.kind !== "unknown-name") return undefined;
  return args.map((a) => ({ name: String(a.name), value: a.value }));
}
