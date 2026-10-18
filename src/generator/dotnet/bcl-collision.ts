// ---------------------------------------------------------------------------
// BCL type-name collisions on the .NET backend.
//
// A `.ddd` type name is a domain noun; some domain nouns are also BCL type
// names that this backend's `using` set brings into scope. `aggregate Task` is
// the case that bites — it is emitted as `Api.Domain.Tasks.Task`, every file
// that touches it does `using Api.Domain.Tasks;`, and those same files do
// `using System.Threading.Tasks;` for the async signatures. Bare `Task` is then
// CS0104 ambiguous, and the generated project does not build AT ALL:
//
//     error CS0104: 'Task' is an ambiguous reference between
//                   'Api.Domain.Tasks.Task' and 'System.Threading.Tasks.Task'
//     error CS0535/CS0738: 'TaskRepository' does not implement
//                   'ITaskRepository.SaveAsync(Task, …)' …
//
// `ddd new --platform dotnet --template crud` emits exactly that model, so the
// shipped starter did not compile — while `generate system` reported
// `0 error(s), 0 warning(s)`.
//
// THE FIX, and why it is shaped this way.  C# resolves a file-scoped
// `using X = N.X;` alias ahead of a wildcard `using N;`, and an alias is NOT
// generic — so in a file carrying `using Task = Api.Domain.Tasks.Task;`:
//
//     Task            → the DOMAIN type          (what the repository wants)
//     Task<Task?>     → BCL Task<> of domain Task (what ITaskRepository wants)
//     async Task Foo  → the DOMAIN type          ← the one broken construct
//
// So the alias fixes the domain references for free, and the ONLY thing left to
// repair is a NON-GENERIC `Task` in return position, which this module's
// `csTaskType` spells for the emitters. Both halves are conditional on an actual
// collision, so a model without one emits byte-identical output.
//
// Nothing is lost by repairing rather than rejecting: a colliding model produces
// no working C# today, so there is no generated API surface to keep compatible.
// ---------------------------------------------------------------------------

import type { AggregateIR, BoundedContextIR } from "../../ir/types/loom-ir.js";
import { escapeCsharpIdent, lowerFirst, upperFirst } from "../../util/naming.js";

/** BCL type names this backend's emitted `using` set brings into scope, so a
 *  same-named domain type is ambiguous rather than merely shadowed.
 *
 *  Deliberately a CURATED list rather than "every type in the BCL": the check
 *  must not reject a domain noun that is only *theoretically* a framework type
 *  (`Order`, `Account`, `Customer` are all `System.*` nothing). Each entry below
 *  is reachable from a namespace the generated files actually import —
 *  `System`, `System.Collections.Generic`, `System.Threading`,
 *  `System.Threading.Tasks`, `System.Linq`, `System.IO`.
 *
 *  `Task` is the only one with a known in-the-wild reproduction (the starter
 *  template); the rest are the same defect waiting for a different domain. */
export const BCL_COLLIDING_TYPE_NAMES: ReadonlySet<string> = new Set([
  // System.Threading.Tasks
  "Task",
  "ValueTask",
  "TaskFactory",
  // System.Threading
  "Timer",
  "Thread",
  "Lock",
  // System.IO
  "File",
  "Directory",
  "Path",
  "Stream",
  // System.Collections.Generic
  "List",
  "Queue",
  "Stack",
  "Comparer",
  "HashSet",
  "Dictionary",
  // System
  "Type",
  "Array",
  "Attribute",
  "Convert",
  "Environment",
  "Console",
  "Random",
  "Version",
  "Math",
  "Buffer",
  "Index",
  "Range",
  "Tuple",
  "Uri",
  "Activator",
  "Exception",
  "Action",
  "Delegate",
  "EventArgs",
  "Progress",
]);

/** How to spell a NON-GENERIC BCL `Task` return in a file that may carry the
 *  domain alias.  `Task` normally (byte-identical), fully qualified when the
 *  context declares a type named `Task`.
 *
 *  Only the non-generic form needs this: `Task<T>` binds to the generic BCL
 *  type regardless of a non-generic alias, so `csTaskOf` is not needed and
 *  `Task<…>` sites are left alone. */
export function csTaskType(taskCollision: boolean): string {
  return taskCollision ? "System.Threading.Tasks.Task" : "Task";
}

/** The BCL-colliding names in scope for a file emitted FOR this aggregate —
 *  the aggregate itself and its entity parts.
 *
 *  This is the ALIAS question, and it is general: any colliding name reached
 *  through `using <ns>.Domain.<Plural>;` is CS0104-ambiguous and needs the
 *  file-scoped alias, whether it is `Task`, `Type`, `Stream` or `Queue`.
 *  (Measured: aliasing only `Task` left `aggregate Type` failing with the same
 *  CS0104/CS0535/CS0738 triple against `System.Type`.) */
export function collidingNamesOfAggregate(agg: Pick<AggregateIR, "name" | "parts">): string[] {
  const out = BCL_COLLIDING_TYPE_NAMES.has(agg.name) ? [agg.name] : [];
  for (const p of agg.parts ?? []) {
    if (BCL_COLLIDING_TYPE_NAMES.has(p.name)) out.push(p.name);
  }
  return [...new Set(out)].sort();
}

/** True when a type named `Task` specifically is in scope for this aggregate's
 *  files — a NARROWER question than `collidingNamesOfAggregate`, and it must
 *  stay narrow.
 *
 *  Only the name `Task` also breaks NON-GENERIC async return positions, because
 *  the alias binds bare `Task` to the domain type and every `async Task Foo()`
 *  in the same file then returns the wrong thing. For `Type` / `Stream` / … the
 *  alias alone is sufficient — the emitter never uses those as a return type —
 *  so qualifying returns for them would churn output for no reason.
 *
 *  Two scopes, one answer: the repository INTERFACE *declares*
 *  `namespace <ns>.Domain.<Plural>`, so its enclosing namespace's `Task` already
 *  beats the implicit `global using System.Threading.Tasks` and silently makes
 *  `Task SaveAsync` return the DOMAIN type (the CS0535/CS0738 pair); the
 *  repository IMPL wildcard-imports that namespace (CS0104). */
export function taskInScopeOfAggregate(agg: Pick<AggregateIR, "name" | "parts">): boolean {
  return collidingNamesOfAggregate(agg).includes("Task");
}

// ---------------------------------------------------------------------------
// Id types colliding with an IMPLICIT global using of the Web SDK.
//
// The main project is `Microsoft.NET.Sdk.Web` with `<ImplicitUsings>`, which
// adds `global using Microsoft.Extensions.Logging;` to every file.  That
// namespace declares a `struct EventId`, so a domain type named `Event` — whose
// identity record is `<ns>.Domain.Ids.EventId` — is CS0104-ambiguous in every
// file that also does `using <ns>.Domain.Ids;` (measured under
// `dotnet build /warnaserror`, sdk:10.0; EF and Dapper alike):
//
//     error CS0104: 'EventId' is an ambiguous reference between
//                   'Api.Domain.Ids.EventId' and
//                   'Microsoft.Extensions.Logging.EventId'
//
// A `using` alias outranks a namespace import at the same scope, so the id file
// opens with `global using EventId = <ns>.Domain.Ids.EventId;` and every file
// resolves the bare name to the domain id.  Only the names listed here get the
// alias, so every other model's id files stay byte-identical.  The generated
// code never names the logging `EventId` itself.
// ---------------------------------------------------------------------------

/** Id-type names (`<Name>Id`) that an implicit SDK `global using` also brings
 *  into every file of the main project. */
export const IMPLICIT_USING_COLLIDING_ID_NAMES: ReadonlySet<string> = new Set([
  // Microsoft.Extensions.Logging (Microsoft.NET.Sdk.Web implicit usings)
  "EventId",
]);

/** The `global using` alias line a domain id file needs so its bare name beats
 *  an implicit SDK import, or `undefined` when the name collides with none. */
export function implicitUsingIdAlias(idName: string, ns: string): string | undefined {
  return IMPLICIT_USING_COLLIDING_ID_NAMES.has(idName)
    ? `global using ${idName} = ${ns}.Domain.Ids.${idName};`
    : undefined;
}

// ---------------------------------------------------------------------------
// Static receivers shadowed by a same-named domain MEMBER.
//
// A domain member spelled `math` is emitted as the C# member `Math`, and
// inside its declaring type C# simple-name lookup finds that MEMBER before any
// type or namespace of the same name.  Every static-receiver reference the
// emitter writes in EXPRESSION position in that scope then binds against the
// member's type instead (measured under `dotnet build /warnaserror`):
//
//     public int Math { get; private set; }
//     public int B => Math.Abs(this.N);
//     error CS0176: Member 'int.Abs(int)' cannot be accessed with an instance
//                   reference; qualify it with a type name instead
//
//     public string Regex { get; private set; }
//     public bool C => Regex.IsMatch(this.Label, "^[a-z]+$");
//     error CS1061: 'string' does not contain a definition for 'IsMatch'
//
// The same holds for every receiver in `CS_BCL_RECEIVER_HOME` below, for the
// project's own static helpers (`DomainLog`, `RequestContext`), for a domain
// service's static class (`Pricing.Quote(…)` beside a `pricing` field) and a
// workflow's `<Wf>Functions` class, and for the `System` namespace root itself
// (`System.Globalization.CultureInfo…` beside a `system` member — CS1061
// "'string' does not contain a definition for 'Globalization'").
//
// THE FIX: on a collision, and only then, the receiver is written fully
// qualified from `global::` (`global::System.Math.Abs(…)`), which no member can
// shadow.  Every other model emits byte-identical output.
//
// TYPE positions (property types, `new System.X(…)`, attributes, casts) are
// unaffected — namespace-or-type-name lookup skips non-type members — so only
// expression-position references go through these helpers.  A member whose own
// type IS the receiver (`DateTime DateTime`) would survive under C#'s
// "Color Color" rule, but qualifying it is equally valid, so the check does not
// bother to tell the two apart.
//
// Domain TYPE names colliding with a member (`Status.Active` beside a `status`
// field of another type) are a separate, refused case —
// `loom.dotnet-name-collision` in src/ir/validate/checks/backend-syntax-checks.ts.
// ---------------------------------------------------------------------------

/** Each BCL type the .NET emitter writes as a static-member receiver in
 *  expression position inside a domain class body, mapped to its namespace.
 *  Built from the emitters, not from guesswork:
 *  `render-expr.ts` (intrinsics `Math.*` / `MidpointRounding` /
 *  `StringComparison`, `Regex.IsMatch`, `TimeSpan.From*`, `now` →
 *  `DateTime.UtcNow`, `Guid.Parse` / `Guid.CreateVersion7`). */
export const CS_BCL_RECEIVER_HOME = {
  Math: "System",
  MidpointRounding: "System",
  StringComparison: "System",
  TimeSpan: "System",
  DateTime: "System",
  Guid: "System",
  Regex: "System.Text.RegularExpressions",
} as const;

export type CsBclReceiver = keyof typeof CS_BCL_RECEIVER_HOME;

/** The simple names a class body declares as members — the scope a
 *  static-receiver reference is resolved in — plus the project root
 *  namespace, so a project-local helper can be qualified from `global::`. */
export interface CsMemberScope {
  /** C# member names (PascalCase), own and inherited. */
  readonly members: ReadonlySet<string>;
  /** The project root namespace (`Api`). */
  readonly ns: string;
}

/** The scope for a class whose `.ddd` members are `memberNames`. */
export function csMemberScope(memberNames: Iterable<string>, ns: string): CsMemberScope {
  return { members: new Set([...memberNames].map(upperFirst)), ns };
}

/** The `.ddd` names a domain TYPE declares as C# members of its own
 *  class/record — fields, containments, derived members, functions and
 *  (aggregates) operations — plus any it inherits (`inherited`, a TPC/TPH
 *  base's fields). */
export function typeMemberNames(
  t: {
    readonly fields: readonly { readonly name: string }[];
    readonly derived: readonly { readonly name: string }[];
    readonly functions: readonly { readonly name: string }[];
    readonly contains?: readonly { readonly name: string }[];
    readonly operations?: readonly { readonly name: string }[];
  },
  inherited: Iterable<string> = [],
): string[] {
  return [
    ...t.fields.map((f) => f.name),
    ...(t.contains ?? []).map((c) => c.name),
    ...t.derived.map((d) => d.name),
    ...t.functions.map((f) => f.name),
    ...(t.operations ?? []).map((o) => o.name),
    ...inherited,
  ];
}

/** A BCL static receiver for an expression-position reference: the bare name
 *  normally (byte-identical), `global::<namespace>.<Name>` when a member of
 *  that name is in scope. */
export function csBcl(name: CsBclReceiver, scope: CsMemberScope | undefined): string {
  return scope?.members.has(name) ? `global::${CS_BCL_RECEIVER_HOME[name]}.${name}` : name;
}

/** The `System` namespace root for an expression-position qualified
 *  reference: `System` normally, `global::System` when a member named
 *  `System` is in scope. */
export function csSystemRoot(scope: CsMemberScope | undefined): string {
  return scope?.members.has("System") ? "global::System" : "System";
}

/** A project-declared static class (`DomainLog`, `RequestContext`, a domain
 *  service, `<Wf>Functions`) living in `<ns>.<nsSuffix>`: the bare name
 *  normally, `global::<ns>.<nsSuffix>.<Name>` when a member of that name is in
 *  scope. */
export function csProjectType(
  name: string,
  nsSuffix: string,
  scope: CsMemberScope | undefined,
): string {
  return scope?.members.has(name) ? `global::${scope.ns}.${nsSuffix}.${name}` : name;
}

// ---------------------------------------------------------------------------
// A PARAMETER spelled exactly like a member of its class.
//
// `.ddd` field names are not case-restricted, so `Guid: string` / `Total: int`
// are legal, and the emitter writes parameters verbatim.  A parameter named
// after a field then IS the member's C# name, and inside the method it hides
// the member — the write `Guid = Guid;` assigns the parameter to itself
// (measured under `dotnet build /warnaserror`, sdk:10.0):
//
//     public Tag(string Guid, int Total, string label) { Guid = Guid; … }
//     error CS1717: Assignment made to same variable; did you mean to assign
//                   something else?
//     (and CS8618 on the never-initialised non-nullable property)
//
// The value-object constructor and the `with crudish` `update(...)` operation
// (whose params are named after the fields it writes) both hit it.  The fix
// renames the PARAMETER — never the member, which is wire surface — to its
// lower-first spelling (`guid`), on a collision only, so every lowercase
// parameter stays byte-identical.  Uses of the parameter follow the same rule
// (`renderRef`'s `param` arm reads `CsRenderContext.memberScope`).
// ---------------------------------------------------------------------------

/** The C# identifier for a `.ddd` parameter declared inside a class whose
 *  members are `scope`: `escapeCsharpIdent(name)` normally (byte-identical),
 *  the lower-first spelling when `name` IS a member's C# name (`Guid` beside a
 *  `Guid` field → `guid`; a name with no case to lower gets a trailing `_`). */
export function csParamIdent(name: string, scope: CsMemberScope | undefined): string {
  if (!scope?.members.has(name)) return escapeCsharpIdent(name);
  const lowered = lowerFirst(name);
  return escapeCsharpIdent(lowered !== name ? lowered : `${name}_`);
}

// ---------------------------------------------------------------------------
// Root-namespace / domain-type collisions.
//
// The project's root namespace is the deployable's Pascal name (system mode)
// or the context's name (legacy `generate dotnet`).  When a hosted context
// declares a TYPE of that very name — `deployable pay` hosting `aggregate
// Pay`, or `context Pay { aggregate Pay }` — every file under `namespace
// Pay.…` resolves a bare `Pay` to the root NAMESPACE before it ever reaches
// the `using Pay.Domain.Pays;` that imports the type (C# looks up the global
// namespace's own members ahead of the compilation unit's using-imports, and a
// `using Pay = …;` alias at that level is ambiguous rather than winning):
//
//     error CS0118: 'Pay' is a namespace but is used like a type
//
// A colliding model produces no buildable project, so there is nothing to keep
// compatible: the root namespace takes an `App` suffix (repeated until it is
// free) and the rest of the project — csproj, DLL, Dockerfile, test project —
// follows it, since every one of them is spelled from the same value.  A model
// without the collision keeps its namespace, byte-identical.
// ---------------------------------------------------------------------------

/** Every type name a hosted context declares into the project's `using` set —
 *  the names a root namespace must not equal. */
function declaredTypeNames(
  contexts: ReadonlyArray<
    Pick<
      BoundedContextIR,
      | "aggregates"
      | "valueObjects"
      | "enums"
      | "events"
      | "payloads"
      | "domainServices"
      | "projections"
      | "siblingValueObjects"
      | "siblingEnums"
    >
  >,
): Set<string> {
  const names = new Set<string>();
  for (const ctx of contexts) {
    for (const agg of ctx.aggregates) {
      names.add(agg.name);
      for (const part of agg.parts) names.add(part.name);
    }
    for (const decl of [
      ...ctx.valueObjects,
      ...ctx.enums,
      ...ctx.events,
      ...ctx.payloads,
      ...ctx.domainServices,
      ...ctx.projections,
      ...(ctx.siblingValueObjects ?? []),
      ...(ctx.siblingEnums ?? []),
    ]) {
      names.add(decl.name);
    }
  }
  return names;
}

/** The project's root namespace: `base` unless a hosted type has that exact
 *  name, in which case `base` + `App` (+ `App` …) — see the block above. */
export function clashFreeRootNamespace(
  base: string,
  contexts: Parameters<typeof declaredTypeNames>[0],
): string {
  const taken = declaredTypeNames(contexts);
  let ns = base;
  while (taken.has(ns)) ns = `${ns}App`;
  return ns;
}

/** A deployable's root namespace: its name with the first letter capitalised,
 *  made clash-free against its hosted contexts.  The ONE spelling the
 *  platform surface (`emitProject`, `debugLaunch`) and the adapter emitters
 *  all key off, so the csproj, the DLL and every `namespace …;` agree. */
export function dotnetRootNamespace(
  deployableName: string,
  contexts: Parameters<typeof declaredTypeNames>[0],
): string {
  return clashFreeRootNamespace(upperFirst(deployableName), contexts);
}
