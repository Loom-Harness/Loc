// ---------------------------------------------------------------------------
// The per-target symbol plan — the one place a DOMAIN construct's emitted
// identifier is decided.
//
// A `.ddd` name is spelled in generated code at its definition and at every
// use.  When each site formats the name itself, the copies drift: the TS
// domain-service function is DEFINED as `calc_base` while a sibling call
// spells `base`; a python method is escaped to `raise_` at its `def` while a
// caller spells `raise`.  The plan computes each spelling once, from the IR
// plus the target's tables, and both sides read it.
//
// What the plan decides, per target:
//   - escaping — reserved words, builtins a class body or module rebinds
//     (`src/util/target-identifiers.ts` holds the tables; the plan is their
//     only reader for domain constructs);
//   - in-scope resolution — a bare call inside a domain-service body naming a
//     sibling operation resolves to that operation's function;
//   - ambient collisions — a domain type whose name a namespace the unit
//     imports also exports (`.NET`: `TaskStatus`, `ServiceProvider`) is
//     bound to the domain type by an alias in each unit that sees both.
//
// Every rule moves ONLY a colliding name: a model without collisions emits
// exactly what it emitted before the plan existed.
// ---------------------------------------------------------------------------

import type { DomainServiceIR } from "../../ir/types/loom-ir.js";
import {
  elixirLocal,
  escapeCsharpIdent,
  escapeJavaIdent,
  escapeTsIdent,
  lowerFirst,
  pythonIdent,
  pythonModuleFn,
  snake,
  upperFirst,
} from "../../util/naming.js";
import { escapeTargetFieldMember, escapeTargetMember } from "../../util/target-identifiers.js";
import { DOTNET_IMPLICIT_USING_NAMESPACES, DOTNET_NAMESPACE_TYPES } from "./ambient-dotnet.js";

/** The targets whose domain layer spells names through the plan. */
export type SymbolTarget = "ts" | "csharp" | "java" | "python" | "elixir";

// ---------------------------------------------------------------------------
// Members and bindings
// ---------------------------------------------------------------------------

/** How one target spells a `.ddd` name in each identifier position.  Each
 *  slot is the target's single funnel for that position — casing and escaping
 *  both — so a definition and every use that read the same slot agree.
 *
 *  `binding` / `method` / `field` take the name as the target already cases
 *  it (python and elixir fold their snake casing in; ts / csharp / java
 *  leave the `.ddd` spelling).  `op` / `prop` / `type` / `stem` take the
 *  `.ddd` name as declared and own the casing too. */
export interface DomainNamer {
  /** A parameter, local or other plain binding. */
  readonly binding: (name: string) => string;
  /** A method or function member, at its declaration and every call. */
  readonly method: (name: string) => string;
  /** The instance member a field is read and written through. */
  readonly field: (name: string) => string;
  /** An aggregate / part operation or function, as the member the domain
   *  class DEFINES and every caller outside it (a workflow step, a handler,
   *  an application service) invokes. */
  readonly op: (name: string) => string;
  /** A field as the member a consumer outside the class reads or sets: the
   *  C# property, the java record component / accessor, the python attribute,
   *  the elixir struct key, the TS getter. */
  readonly prop: (name: string) => string;
  /** A `.ddd` name as the leading segment of a type-level identifier the
   *  target derives from it (`<Type>State`, `load<Type>`, a module segment). */
  readonly type: (name: string) => string;
  /** A `.ddd` name as the leading segment of a value-level identifier the
   *  target derives from it: a repository or service handle, a function
   *  (`<stem>Routes`, `run_<stem>`), a module file stem.  Unescaped — the
   *  site appends or prepends its own affix. */
  readonly stem: (name: string) => string;
}

/** The domain namer of every target.  The domain emitters (aggregate, part,
 *  value-object, enum, event and domain-service classes) and the workflow /
 *  handler emitters spell names only through these slots;
 *  `test/system/symbol-plan-census.test.ts` keeps the raw funnels and the
 *  casing helpers out of those files. */
export const DOMAIN_NAMES: Readonly<Record<SymbolTarget, DomainNamer>> = {
  ts: {
    binding: escapeTsIdent,
    method: (n) => escapeTargetMember("ts", n),
    field: (n) => escapeTargetFieldMember("ts", n),
    op: (n) => escapeTargetMember("ts", lowerFirst(n)),
    prop: (n) => escapeTargetFieldMember("ts", n),
    type: upperFirst,
    stem: lowerFirst,
  },
  csharp: {
    binding: escapeCsharpIdent,
    method: escapeCsharpIdent,
    field: escapeCsharpIdent,
    op: upperFirst,
    prop: upperFirst,
    type: upperFirst,
    stem: lowerFirst,
  },
  java: {
    binding: escapeJavaIdent,
    method: escapeJavaIdent,
    field: escapeJavaIdent,
    op: escapeJavaIdent,
    prop: escapeJavaIdent,
    type: upperFirst,
    stem: lowerFirst,
  },
  python: {
    binding: pythonIdent,
    method: pythonIdent,
    field: pythonIdent,
    op: pythonIdent,
    prop: pythonIdent,
    type: upperFirst,
    stem: snake,
  },
  elixir: {
    binding: elixirLocal,
    method: elixirLocal,
    field: elixirLocal,
    op: snake,
    prop: snake,
    type: upperFirst,
    stem: snake,
  },
};

/** A python MODULE-LEVEL function for a `.ddd` name — the member spelling,
 *  further escaped when it would rebind a builtin for the whole module. */
export const pythonModuleFnName: (name: string) => string = pythonModuleFn;

// ---------------------------------------------------------------------------
// Domain-service operations
// ---------------------------------------------------------------------------

/** The TS function a domain-service operation is DEFINED as, and the
 *  spelling every call from inside its own service body uses.  TS emits
 *  every service of a context into one module of free functions, so the
 *  operation is qualified by its service (`calc_base`): two services may
 *  declare the same operation name. */
export function tsServiceOpFn(service: string, op: string): string {
  return `${lowerFirst(service)}_${lowerFirst(op)}`;
}

/** Resolves a bare call name inside one of `service`'s TS operation bodies:
 *  a sibling operation's name → its {@link tsServiceOpFn}; anything else →
 *  `undefined` (the caller spells it as written). */
export function tsServiceSiblingScope(
  service: Pick<DomainServiceIR, "name" | "operations">,
): (name: string) => string | undefined {
  const ops = new Map(service.operations.map((o) => [o.name, tsServiceOpFn(service.name, o.name)]));
  return (name) => ops.get(name);
}

// ---------------------------------------------------------------------------
// Ambient type collisions (.NET)
// ---------------------------------------------------------------------------

/** The namespaces a C# compilation unit imports by simple name: the Web SDK's
 *  implicit usings plus every top-level `using N;` it writes (aliases and
 *  `using static` import no simple names of a namespace). */
export function dotnetImportedNamespaces(src: string): string[] {
  const explicit = [...src.matchAll(/^using[ \t]+([A-Za-z_][\w.]*)[ \t]*;/gm)].map((m) => m[1]);
  return [...DOTNET_IMPLICIT_USING_NAMESPACES, ...explicit];
}

/** True when one of `imported` brings a framework type named `name` into
 *  scope — so a domain type of that name, imported into the same unit, is
 *  ambiguous (CS0104: `TaskStatus` against `System.Threading.Tasks`,
 *  `ServiceProvider` against `Microsoft.Extensions.DependencyInjection`). */
export function dotnetAmbientClash(name: string, imported: readonly string[]): boolean {
  return imported.some((ns) => AMBIENT_BY_NS.get(ns)?.has(name) ?? false);
}

/** True when any imported namespace could clash with `name` — the cheap
 *  project-wide prefilter for {@link dotnetAmbientClash}. */
export function isDotnetAmbientTypeName(name: string): boolean {
  return ALL_AMBIENT.has(name);
}

const AMBIENT_BY_NS: ReadonlyMap<string, ReadonlySet<string>> = new Map(
  Object.entries(DOTNET_NAMESPACE_TYPES).map(([ns, names]) => [ns, new Set(names)]),
);
const ALL_AMBIENT: ReadonlySet<string> = new Set(Object.values(DOTNET_NAMESPACE_TYPES).flat());
