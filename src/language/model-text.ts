// ---------------------------------------------------------------------------
// `label(…)` / `plural(…)` path resolution — the one resolver the AST
// validator (`validators/model-text.ts`) and the lowering (`lower-expr.ts`)
// share, so a path the validator accepts lowers to exactly the key it checked.
//
// A path is `[Ctx.]Type[.member]`:
//
//   Type    an aggregate, entity part, value object, enum, workflow, or
//           declared `error` payload;
//   member  a field, containment, derived field, operation, create / destroy,
//           workflow input, or enum value.
//
// The context qualifier is needed only when the type name is declared in more
// than one context.  A type declared outside every context (a root-level enum,
// value object or error) resolves with `ctx: undefined` — the `_system`
// namespace of `src/util/model-text-key.ts`.
//
// The index is built from the expanded AST (macro output included), so a
// `with crudish` aggregate's generated `create` / `update` are members.
// ---------------------------------------------------------------------------

import { type AstNode, AstUtils } from "langium";
import type { ModelTextFacet } from "../util/model-text-key.js";
import type {
  Aggregate,
  BoundedContext,
  EntityPart,
  EnumDecl,
  PayloadDecl,
  ValueObject,
  Workflow,
} from "./generated/ast.js";

/** The kind of type a path's head names. */
export type ModelTextTypeKind =
  | "aggregate"
  | "part"
  | "valueobject"
  | "enum"
  | "workflow"
  | "error";

/** One declared type and the members a path may name on it. */
interface IndexedType {
  readonly ctx: string | undefined;
  readonly name: string;
  readonly kind: ModelTextTypeKind;
  /** member name → facet it is keyed under. */
  readonly members: ReadonlyMap<string, ModelTextFacet>;
}

/** Every type a `label(…)` path may name, by type name (a name declared in
 *  several contexts maps to several entries). */
export type ModelTextIndex = ReadonlyMap<string, readonly IndexedType[]>;

/** A resolved path: what the key helper needs, plus the type kind. */
export interface ModelTextResolution {
  readonly ok: true;
  readonly ctx: string | undefined;
  readonly type: string;
  readonly typeKind: ModelTextTypeKind;
  readonly facet: ModelTextFacet;
  readonly member?: string;
}

/** Why a path did not resolve. */
export interface ModelTextFailure {
  readonly ok: false;
  /** `unresolved` — no such type/member; `plural-member` — `plural()` on a
   *  member, an enum or an error; `ambiguous` — the type name is declared in
   *  several contexts and the path does not qualify it. */
  readonly reason: "unresolved" | "plural-member" | "ambiguous";
}

function membersOfAggregateLike(members: readonly AstNode[]): Map<string, ModelTextFacet> {
  const out = new Map<string, ModelTextFacet>();
  for (const m of members) {
    switch (m.$type) {
      case "Property":
      case "Containment":
      case "DerivedProp":
        out.set((m as unknown as { name: string }).name, "field");
        break;
      case "Operation":
        out.set((m as unknown as { name: string }).name, "op");
        break;
      case "Create":
        out.set((m as unknown as { name?: string }).name ?? "create", "op");
        break;
      case "Destroy":
        out.set((m as unknown as { name?: string }).name ?? "destroy", "op");
        break;
    }
  }
  return out;
}

function workflowMembers(wf: Workflow): Map<string, ModelTextFacet> {
  const out = new Map<string, ModelTextFacet>();
  for (const m of wf.members) {
    if (m.$type === "Property") out.set(m.name, "field");
    else if (m.$type === "WorkflowCreateDecl") for (const p of m.params) out.set(p.name, "field");
  }
  return out;
}

function add(index: Map<string, IndexedType[]>, t: IndexedType): void {
  const list = index.get(t.name);
  if (!list) index.set(t.name, [t]);
  else if (!list.some((x) => x.ctx === t.ctx && x.kind === t.kind)) list.push(t);
}

function indexContextMember(
  index: Map<string, IndexedType[]>,
  ctx: string | undefined,
  m: AstNode,
): void {
  switch (m.$type) {
    case "Aggregate": {
      const agg = m as Aggregate;
      add(index, {
        ctx,
        name: agg.name,
        kind: "aggregate",
        members: membersOfAggregateLike(agg.members),
      });
      for (const part of agg.members) {
        if (part.$type !== "EntityPart") continue;
        const p = part as EntityPart;
        add(index, { ctx, name: p.name, kind: "part", members: membersOfAggregateLike(p.members) });
      }
      break;
    }
    case "ValueObject": {
      const vo = m as ValueObject;
      add(index, {
        ctx,
        name: vo.name,
        kind: "valueobject",
        members: membersOfAggregateLike(vo.members),
      });
      break;
    }
    case "EnumDecl": {
      const en = m as EnumDecl;
      add(index, {
        ctx,
        name: en.name,
        kind: "enum",
        members: new Map(en.values.map((v) => [v.name, "value" as const])),
      });
      break;
    }
    case "Workflow": {
      const wf = m as Workflow;
      add(index, { ctx, name: wf.name, kind: "workflow", members: workflowMembers(wf) });
      break;
    }
    case "PayloadDecl": {
      const p = m as PayloadDecl;
      if (p.kind === "error") add(index, { ctx, name: p.name, kind: "error", members: new Map() });
      break;
    }
  }
}

/** Build the index over every document root of a project. */
export function buildModelTextIndex(roots: Iterable<AstNode>): ModelTextIndex {
  const index = new Map<string, IndexedType[]>();
  for (const root of roots) {
    for (const node of AstUtils.streamAllContents(root)) {
      if (node.$type === "BoundedContext") {
        const bc = node as BoundedContext;
        for (const m of bc.members) indexContextMember(index, bc.name, m);
      } else if (node.$container === root) {
        // Root-level enum / value object / error payload — system scope.
        indexContextMember(index, undefined, node);
      }
    }
  }
  return index;
}

/** Resolve a `label(…)` / `plural(…)` path against the index. */
export function resolveModelText(
  kind: "label" | "plural",
  path: readonly string[],
  index: ModelTextIndex,
): ModelTextResolution | ModelTextFailure {
  if (path.length === 0 || path.length > 3) return { ok: false, reason: "unresolved" };
  // `[Ctx.]Type[.member]` — try the qualified reading first when it fits.
  const readings: { ctx?: string; type: string; member?: string }[] = [];
  if (path.length === 3) readings.push({ ctx: path[0], type: path[1]!, member: path[2] });
  if (path.length === 2) {
    readings.push({ type: path[0]!, member: path[1] });
    readings.push({ ctx: path[0], type: path[1]! });
  }
  if (path.length === 1) readings.push({ type: path[0]! });
  let ambiguous = false;
  for (const r of readings) {
    const candidates = (index.get(r.type) ?? []).filter(
      (t) => r.ctx === undefined || t.ctx === r.ctx,
    );
    if (candidates.length === 0) continue;
    const viable =
      r.member === undefined ? candidates : candidates.filter((t) => t.members.has(r.member!));
    if (viable.length === 0) continue;
    if (viable.length > 1) {
      ambiguous = true;
      continue;
    }
    const t = viable[0]!;
    if (r.member !== undefined) {
      if (kind === "plural") return { ok: false, reason: "plural-member" };
      return {
        ok: true,
        ctx: t.ctx,
        type: t.name,
        typeKind: t.kind,
        facet: t.members.get(r.member)!,
        member: r.member,
      };
    }
    if (kind === "plural" && (t.kind === "enum" || t.kind === "error")) {
      return { ok: false, reason: "plural-member" };
    }
    const facet: ModelTextFacet =
      t.kind === "error" ? "message" : kind === "plural" ? "name.other" : "name.one";
    return { ok: true, ctx: t.ctx, type: t.name, typeKind: t.kind, facet };
  }
  return { ok: false, reason: ambiguous ? "ambiguous" : "unresolved" };
}
