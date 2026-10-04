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

import type { AggregateIR } from "../../ir/types/loom-ir.js";
import { upperFirst } from "../../util/naming.js";

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
