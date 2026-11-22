# D-COMMAND-BUS — a command or query record has one handler, decided once

**Status:** decided by the owner, 2026-11-16 (rulings 130, 153, 264–281 on the
transaction-scoping design).

**Question.** A request is a declared `command` or `query` record.  Which
handler catches it, and how does a route, a workflow or a test reach that
handler on each of the five backends?

**Decision.** A record has exactly one handler: a `commandHandler` /
`queryHandler` whose only parameter is that record, or a workflow `create`
whose only parameter is that command record.  The plan's `handlerFor`
(`src/ir/plan/command-bus.ts`) states which; `handlersOf` lists every
candidate so the validator refuses none and several, and `busEntries` lists a
context's dispatched records in declaration order.  A handler of the other
kind is not a candidate.

Each backend renders the bus generated and statically typed, in its own idiom
(`src/generator/_workflow/command-bus.ts`): a mapping from each record to its
handler that the generated project's compiler checks.  A record with no
handler fails to compile; no backend looks a handler up by name or reflection
at run time.  Every handler takes `(record, ctx)`: `ctx` is one parameter on
all five backends, carrying the principal and the transaction handle, and
later work widens `ctx`, never a handler signature.

A route, a workflow `send` and a test call a handler only through its
`dispatch<Record>` function, so a later change of the handler shape touches
the dispatch bodies and the handler emitters only.  The history reader and the
workflow-instance reader are read functions that both a derived route and a
handler body call; they are not handlers and stay direct.

**Rationale.** Which handler catches a record is a decision, not a style: two
backends resolving it differently would send the same request to different
code.

**Proof.** `test/ir/plan/command-bus.test.ts` covers a command, a query, a
workflow create, a record with no handler, one with two, and a handler of the
wrong kind.  The `command-bus` rule of
`test/system/workflow-plan-census.test.ts` fails when a backend picks a handler
out of a context's handler list itself; each backend's remaining lookup is a
deferred waiver that the route-`send` change deletes.  Node's bus
(`http/<context>-bus.ts`) maps each record to its `dispatch<Record>` through a
tagged union and an exhaustive `switch` with a `never` check; deleting a case
fails the generated project's `tsc` (`corpus-tsc-build` over `send-routes`).  Python's
(`app/application/<context>_bus.py`) overloads `send` per record, matches each
record's class and ends in `assert_never`; deleting a case fails `mypy --strict`
(`corpus-python-build` over `send-routes`).  Java's request records implement a sealed
`<Context>Request`, and `<Context>Bus.send` is a pattern `switch` over it plus one
overload per record; a missing case fails `javac` (`corpus-java-build` over
`send-routes`).  .NET's bus is the Mediator source generator, which reports a request
with no handler only when it is sent, so each dispatched request record carries a
compile-time binding to its handler class (a type argument constrained to the
record's handler interface); a missing handler fails `dotnet build`
(`corpus-dotnet-build` over `send-routes`).

**Enforced by:** `test/ir/plan/command-bus.test.ts`, `test/generator/_workflow/command-bus.test.ts`, `test/generator/node-command-bus.test.ts`, `test/generator/python-command-bus.test.ts`, `test/generator/java-command-bus.test.ts`, `test/generator/dotnet-command-bus.test.ts`, `test/system/workflow-plan-census.test.ts`
