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
import {
  dotnetAmbientClash,
  dotnetImportedNamespaces,
  isDotnetAmbientTypeName,
  isDotnetRootNamespace,
} from "../_symbols/plan.js";
import { rewriteCode } from "./cs-code-scan.js";
import { CS_NAME, CS_PROJECT_TYPE_HOME } from "./cs-symbols.js";

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
 *  normally, `global::<namespace>.<Name>` when a member of that name is in
 *  scope.  `DateTime` is a name reference (`CS_NAME`), so a domain TYPE named
 *  `DateTime` qualifies it too. */
export function csBcl(name: CsBclReceiver, scope: CsMemberScope | undefined): string {
  if (scope?.members.has(name)) return `global::${CS_BCL_RECEIVER_HOME[name]}.${name}`;
  return name === "DateTime" ? CS_NAME.DateTime : name;
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
 *  scope.  `RequestContext` is a name reference (`CS_NAME`), so a domain TYPE
 *  named `RequestContext` qualifies it too. */
export function csProjectType(
  name: string,
  nsSuffix: string,
  scope: CsMemberScope | undefined,
): string {
  if (scope?.members.has(name)) return `global::${scope.ns}.${nsSuffix}.${name}`;
  return name === "RequestContext" ? CS_NAME.RequestContext : name;
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
// The project's root namespace is the deployable's Pascal name.  When a hosted context
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
 *  the names a root namespace must not equal, and the names a platform
 *  reference is spelled `global::`-qualified for (`_imports/dotnet.ts`). */
export function declaredTypeNames(
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

// ---------------------------------------------------------------------------
// Domain types whose simple name something else owns in a unit.
//
// A hosted type is reached from the project's other units by its simple name,
// and four things can own that name first:
//
//   - a NAMESPACE the unit's enclosing namespaces contain.  Every project file
//     lives under `<Root>.<Layer>…`, so `aggregate Application` is
//     unreachable from `namespace Shop.Infrastructure.Repositories`: lookup
//     walks out through `Shop`, whose member namespace `Application` wins
//     before the compilation unit's `using Shop.Domain.Applications;` is ever
//     consulted.  The same holds for a deeper namespace (`aggregate
//     Persistence` beside `<Root>.Infrastructure.Persistence`, from every unit
//     under `<Root>.Infrastructure`) and for the root namespace of a
//     referenced assembly (`System`, `OpenTelemetry`), which the global
//     namespace contains (measured under `dotnet build /warnaserror`,
//     sdk:10.0):
//
//         error CS0118: 'Application' is a namespace but is used like a type
//
//   - a type the project GENERATES for itself (`DomainException`,
//     `RequestContext`, `HttpMetrics`): a unit importing both its namespace
//     and the domain type's is CS0104-ambiguous;
//   - a type an imported framework namespace exports (`_symbols/plan.ts`);
//   - for an aggregate's id, a `System` type (`ApplicationId`).
//
// THE FIX: an alias declared INSIDE the file's namespace declaration
// (`namespace Shop.Api; using Application = global::Shop.Domain.Applications.Application;`)
// is looked up at that namespace's level — ahead of both the enclosing
// namespaces' members and the compilation unit's wildcard usings — so the
// domain type keeps its bare name in every unit.  What the alias displaces
// is spelled `global::`: a generated type and a BCL type the emitters name
// are reference markers that the finalizer already qualifies
// (`_imports/dotnet.ts`), and a namespace the unit names as a qualifier
// (`System.Globalization.CultureInfo`) is rewritten here, except where the
// qualifier names a static member of the domain type (`Status.Active`).
//
// A unit whose own namespace declares a type of that name (the generated
// type's namespace: `<Root>.Api` declares `ProblemDetailsError`), or holds a
// member namespace of it, cannot take the alias (CS0576): there the generated
// meaning keeps the bare name, and each bare reference that is the domain
// type's — every bare one, since the project's own references are markers —
// is spelled `global::` instead.  The file declaring the type is left alone.
//
// Every alias is appended to the namespace line itself so no generated line
// moves (sourcemaps and `#line` stay exact), and only on a collision, so
// every other model is byte-identical.
// ---------------------------------------------------------------------------

/** `System` types spelled `<Noun>Id` — the id class of a same-named
 *  aggregate (`aggregate Application` → `ApplicationId`) is CS0104-ambiguous
 *  with them in every file that imports `System` and `<Root>.Domain.Ids`. */
export const BCL_COLLIDING_ID_NAMES: ReadonlySet<string> = new Set(["ApplicationId"]);

/** A `.cs` file's first namespace declaration: its name, and the offset just
 *  past the `;` (file-scoped) or `{` (block-scoped) that opens it. */
function namespaceDecl(src: string): { ns: string; insertAt: number } | undefined {
  const m = /^namespace[ \t]+([\w.]+)[ \t]*(?:;|\r?\n?[ \t]*\{)/m.exec(src);
  if (!m) return undefined;
  return { ns: m[1], insertAt: m.index + m[0].length };
}

/** The aggregate / part names the compilation-unit aliases of
 *  {@link collidingNamesOfAggregate} bind in the files emitted for them. */
function perFileAliasedNames(contexts: Parameters<typeof declaredTypeNames>[0]): Set<string> {
  return new Set(contexts.flatMap((c) => c.aggregates.flatMap(collidingNamesOfAggregate)));
}

/** A type declaration of `t` at the start of a line. */
const declares = (t: string): RegExp =>
  new RegExp(`^(?:\\w+ )*(?:class|struct|record|interface|enum) ${t}\\b`, "m");

/** `ns` and every namespace enclosing it, innermost first. */
function enclosing(ns: string): string[] {
  const segs = ns.split(".");
  return segs.map((_, i) => segs.slice(0, segs.length - i).join("."));
}

/** The names a domain type's declaring file makes reachable through the type
 *  (`<Type>.<Member>`): an enum's members, a class's static members. */
function staticMembers(src: string, t: string): Set<string> {
  const names = new Set<string>();
  const decl = declares(t).exec(src);
  if (!decl) return names;
  const body = src.slice(decl.index);
  if (/\benum\b/.test(decl[0])) {
    const open = body.indexOf("{");
    const close = body.indexOf("}", open);
    for (const part of body.slice(open + 1, close).split(",")) {
      const m = /([A-Za-z_]\w*)/.exec(part.replace(/\/\/.*$/gm, "").replace(/\[[^\]]*\]/g, ""));
      if (m) names.add(m[1]!);
    }
    return names;
  }
  for (const m of body.matchAll(/\bstatic\b[^;{}=()]*?\b(\w+)\s*(?:<[^>]*>)?\s*(?:\(|=>|=|\{|;)/g))
    names.add(m[1]!);
  for (const m of body.matchAll(/\bconst\b[^;=]*?\b(\w+)\s*=/g)) names.add(m[1]!);
  for (const m of body.matchAll(/\b(?:class|struct|record|interface|enum)\s+(\w+)/g))
    names.add(m[1]!);
  return names;
}

/** Alias every hosted type whose simple name something else owns (see the
 *  block above) inside each `<root>.…` namespace declaration of `out`, and
 *  spell what the alias displaces `global::`.  Returns the rewritten files;
 *  empty without a collision. */
export function layerClashAliases(
  out: ReadonlyMap<string, string>,
  root: string,
  contexts: Parameters<typeof declaredTypeNames>[0],
): Map<string, string> {
  const rewritten = new Map<string, string>();
  const files: { path: string; src: string; ns: string; insertAt: number }[] = [];
  for (const [path, src] of out) {
    if (!path.endsWith(".cs")) continue;
    const decl = namespaceDecl(src);
    if (decl && (decl.ns === root || decl.ns.startsWith(`${root}.`)))
      files.push({ path, src, ...decl });
  }
  // Every namespace the project declares, with its ancestors, and for each
  // simple name the namespaces that hold a member namespace of that name.
  const namespaces = new Set<string>();
  for (const f of files) for (const n of enclosing(f.ns)) namespaces.add(n);
  const parentsOf = new Map<string, Set<string>>();
  for (const n of namespaces) {
    const at = n.lastIndexOf(".");
    if (at < 0 || !n.startsWith(`${root}.`)) continue;
    const name = n.slice(at + 1);
    if (!parentsOf.has(name)) parentsOf.set(name, new Set());
    parentsOf.get(name)!.add(n.slice(0, at));
  }
  /** The namespace named `t` that lookup from `ns` reaches first, if any. */
  const shadowingNamespace = (t: string, ns: string): string | undefined => {
    for (const p of enclosing(ns)) if (parentsOf.get(t)?.has(p)) return `${p}.${t}`;
    return isDotnetRootNamespace(t) ? t : undefined;
  };

  const candidates = declaredTypeNames(contexts);
  for (const ctx of contexts) {
    for (const agg of ctx.aggregates) candidates.add(`${agg.name}Id`);
  }
  // The generated namespace of a project type a hosted type is named like.
  const generatedHome = new Map<string, string>();
  for (const [t, rel] of Object.entries(CS_PROJECT_TYPE_HOME)) {
    if (candidates.has(t)) generatedHome.set(t, `${root}.${rel}`);
  }
  const always = new Set(
    [...candidates].filter(
      (t) =>
        parentsOf.has(t) ||
        isDotnetRootNamespace(t) ||
        BCL_COLLIDING_ID_NAMES.has(t) ||
        generatedHome.has(t),
    ),
  );
  // A type an imported framework namespace also exports clashes only in the
  // units that import both (`_symbols/plan.ts`).  The aggregates and parts the
  // per-file aliases above already bind are left to them.
  const perFile = perFileAliasedNames(contexts);
  const ambient = new Set(
    [...candidates].filter((t) => !always.has(t) && !perFile.has(t) && isDotnetAmbientTypeName(t)),
  );
  const clashing = [...always, ...ambient].sort();
  if (clashing.length === 0) return rewritten;

  // Where each clashing type is declared — read off the output, so the alias
  // follows whichever directory layout placed it.  The project's own type of
  // that name is not a home; a name declared in more than one other
  // namespace has no single target and is left alone.
  const home = new Map<string, string>();
  const homeFile = new Map<string, string>();
  for (const t of clashing) {
    const homes = files.filter((f) => f.ns !== generatedHome.get(t) && declares(t).test(f.src));
    const nss = new Set(homes.map((f) => f.ns));
    if (nss.size === 1) {
      home.set(t, [...nss][0]!);
      homeFile.set(t, homes[0]!.src);
    }
  }
  /** Namespaces declaring a type of each clashing name (the generated one's). */
  const declaredIn = new Map<string, Set<string>>();
  for (const t of home.keys()) {
    declaredIn.set(t, new Set(files.filter((f) => declares(t).test(f.src)).map((f) => f.ns)));
  }

  for (const f of files) {
    const imported = dotnetImportedNamespaces(f.src);
    const sees = (t: string, ns: string): boolean =>
      (always.has(t) &&
        (generatedHome.has(t) ||
          BCL_COLLIDING_ID_NAMES.has(t) ||
          shadowingNamespace(t, f.ns) !== undefined)) ||
      (imported.includes(ns) && dotnetAmbientClash(t, imported));
    const aliases: string[] = [];
    let body = f.src.slice(f.insertAt);
    for (const [t, ns] of home) {
      if (!new RegExp(`\\b${t}\\b`).test(f.src)) continue;
      /** Spell the namespace the domain type displaces in this unit as
       *  `global::<ns>.` wherever the unit names it as a qualifier. */
      const unshadow = (): void => {
        const shadowed = shadowingNamespace(t, f.ns);
        if (shadowed === undefined) return;
        const members = staticMembers(homeFile.get(t)!, t);
        body = rewriteCode(body, new RegExp(`(?<![\\w.:@])${t}\\.(\\w+)`, "g"), (m) =>
          members.has(m[1]!) ? undefined : `global::${shadowed}.${m[1]}`,
        );
      };
      if (f.ns === ns || declares(t).test(f.src)) {
        // The type's own namespace binds the name to it already.
        unshadow();
        continue;
      }
      if (!sees(t, ns)) continue;
      const fq = `global::${ns}.${t}`;
      if (namespaces.has(`${f.ns}.${t}`) || declaredIn.get(t)!.has(f.ns)) {
        // No alias here (CS0576): the bare name keeps the generated meaning —
        // the member namespace a qualifier names, or the generated type — and
        // the domain type's references are spelled in full.
        const members = staticMembers(homeFile.get(t)!, t);
        body = rewriteCode(body, new RegExp(`(?<![\\w.:@])${t}(?!\\w)(\\.\\w+)?`, "g"), (m) => {
          const member = m[1]?.slice(1);
          if (member !== undefined && !members.has(member)) return undefined;
          return `${fq}${m[1] ?? ""}`;
        });
        continue;
      }
      aliases.push(` using ${t} = ${fq};`);
      unshadow();
    }
    const src = f.src.slice(0, f.insertAt) + aliases.join("") + body;
    if (src !== f.src) rewritten.set(f.path, src);
  }
  return rewritten;
}

/** Drop a `using N;` line that repeats one above it in the leading using
 *  block — two namespaces the emitters import can be one when a domain type
 *  is named like a generated namespace (`aggregate Enum` lives in
 *  `<Root>.Domain.Enums`), and a repeated directive is CS0105.  Returns the
 *  rewritten files; empty without a repeat. */
export function dedupeUsings(out: ReadonlyMap<string, string>): Map<string, string> {
  const rewritten = new Map<string, string>();
  for (const [path, src] of out) {
    if (!path.endsWith(".cs")) continue;
    const lines = src.split("\n");
    const seen = new Set<string>();
    const kept: string[] = [];
    let inHeader = true;
    for (const l of lines) {
      if (inHeader && /^namespace\b/.test(l)) inHeader = false;
      const m = inHeader ? /^using\s+([\w.]+)\s*;\s*$/.exec(l) : null;
      if (m && seen.has(m[1]!)) continue;
      if (m) seen.add(m[1]!);
      kept.push(l);
    }
    if (kept.length !== lines.length) rewritten.set(path, kept.join("\n"));
  }
  return rewritten;
}
