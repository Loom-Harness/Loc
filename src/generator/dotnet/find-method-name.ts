import { upperFirst } from "../../util/naming.js";

/** Methods every generated .NET repository declares for itself (interface and
 *  EF / Dapper implementations, public and private).  A declared find is
 *  emitted PascalCased with no `Async` suffix, so a find named `getByIdAsync`
 *  would land as a second `GetByIdAsync(OrderId, CancellationToken)` — CS0111
 *  when the parameter lists match, a silent overload of the built-in when they
 *  don't. */
const CS_REPOSITORY_BUILTIN_METHODS: ReadonlySet<string> = new Set([
  "GetByIdAsync",
  "GetByIdForWriteAsync",
  "FindManyByIdsAsync",
  "SaveAsync",
  "DeleteAsync",
  "HydrateAsync",
  "LoadRefsAsync",
  "Map",
  "RowToEvent",
]);

/** The C# method name a declared repository `find` is emitted under — at its
 *  definition (repository interface + implementations) AND at every call site
 *  (query handlers, workflow / handler loads, domain-service reads, tests).
 *  PascalCase of the find name, escaped with a `Find` suffix when it would
 *  collide with a built-in repository method, so no find name is reserved
 *  because of this backend. */
export function csFindMethodName(findName: string): string {
  const name = upperFirst(findName);
  return CS_REPOSITORY_BUILTIN_METHODS.has(name) ? `${name}Find` : name;
}
