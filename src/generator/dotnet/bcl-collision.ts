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
