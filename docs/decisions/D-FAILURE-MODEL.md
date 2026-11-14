# D-FAILURE-MODEL — Loom has no exceptions: each failure kind has one construct, and an expected failure is a value the caller must handle

**Status:** PINNED (owner rulings 2026-10-25 on #4134, #4146, #3951, #3916;
parent #4120).

**Question.** A domain operation can fail in five different ways, and the
language had a construct for each, but nothing made a caller deal with the one
kind that is the caller's business: an expected failure declared in the
signature (`operation withdraw(amt: money): Account or InsufficientCredit`). A
call statement dropped it, and a workflow answered 204.

**Decision.** One construct per failure kind, chosen by who can act on it:

| kind | construct | outcome |
|---|---|---|
| absence | `T?` + narrowing | `null` |
| invalid input | value-object invariant, wire validation | 422 |
| precondition | `precondition` (RS-15) | 422 `DomainError` |
| expected failure | `A or E` with an `error` record (`httpStatus` maps it) | the caller's to handle; at the wire, problem+json at the mapped status |
| bug | aggregate invariant | 500 |

- **An expected failure is a value, handled in process.** An `or E` result
  whose `E` is an `error` must be matched, returned through a caller whose own
  declared result admits it, or bound and read (`loom.unhandled-result`). A call
  statement and an unread `let` discard it. There is no implicit propagation
  and no `?` operator. (#4134)
- **Returning `E` discards the operation's writes.** An operation that returns
  an `error` variant leaves no trace: nothing it assigned is saved, and the
  events it raised are neither published nor written to the outbox — the same
  as a failed `precondition`. A failed attempt that must be recorded is
  recorded explicitly. (#4146)
- **A read does not encode absence as an error.** `T or NotFound` finds go; a
  read that may miss is `T?` (`find…`), one that must hit is `T` (`get…`, the
  standard 404). (#3951)
- **Workflows return `or E` too**: a routed command entry point answers an
  expected failure, rolled back whole on the error (see Consequences). (#3916)
- **The wire is the boundary.** In process an `E` is a value; a route renders
  it as problem+json at its `httpStatus` (D-WIRE-POLICY,
  `errorVariantResponse`), never as a 200 union.

**Consequences.** `loom.unhandled-result` refuses a dropped `or E`
(`src/language/validators/unhandled-result.ts`). A workflow / handler body
handles a bound result with the statement `match` (#3367; D-FOR-IN-DOMAIN's
amendment) or by reading it.
Every backend's operation route or handler checks the error variant before it
stamps, saves, audits or publishes (Java also marks the transaction
rollback-only, since its loaded aggregate is a managed entity); the
`operation-returns` corpus golden pins the unchanged read-back on every
behavioural leg.

A workflow / handler body that binds a MUTATING call whose result has an
`error` variant (`let r = a.withdraw(x)`, or `let r = Transfer.run(…)` over a
`mutating` domain service) holds a tentative change, so the same rule applies
inside the body: the body must `match r`
(`loom.workflow-mutation-result-unmatched`), each non-error arm saves the
mutated aggregate at its end and publishes what it drained, and an error arm
saves nothing for it — its change and its events are dropped. On EF Core and
JPA, which flush a loaded entity whether or not it was saved, the error arm
detaches it through the repository's `Discard` / `discard`; node and python
write only on a save. An `else` arm that covers both a success and an error
variant is refused, and so is any other change to the same aggregate in that
body. A bound mutating call whose result has no `error` variant is saved at the
body's exit, exactly like the call statement. Phoenix refuses the bound form
(`loom.elixir-bound-mutating-call-unsupported`).

```ddd
workflow Pay {
  create(id: Account id, amt: int) {
    let a = Accounts.get(id)
    let r = a.withdraw(amt)          // withdraw(amt): int or Insufficient
    match r {
      int left => { }                // a is saved here
      Insufficient e => { notFound } // a's change is dropped
    }
  }
}
```

```ts
// node — d/http/workflows.ts
const a = await accounts.getById(id);
const r = a.withdraw(amt);
switch (r.type) {
  case "int": {
    const left = r.value;
    await accounts.save(a);
    break;
  }
  case "Insufficient": {
    const e = r;
    throw new AggregateNotFoundError("Resource not found");
    break;
  }
}
```

A routed command entry point — the workflow `create` its `POST` serves, a
`commandHandler`, a `queryHandler` — may itself answer `or E`, from a tail
`return` or from the `return` ending each arm of its terminal `match`
(13-workflows.md, "Expected failures").  "An error leaves no trace" then
covers the WHOLE command, not one call: the entry point runs in one
transaction whether or not it is `transactional`, and an error answer rolls
back everything it did — the saves before the `match`, the saga row,
outbox / audit / provenance rows, the error arm's own writes — and dispatches
no event; the route translates the error exactly as an operation route does.

```ddd
workflow Pay {
  create(account: Account id, amt: int): Receipt or PaymentDeclined {
    let a = Accounts.get(account)
    let r = a.withdraw(amt)
    match r {
      int left => { return Receipt { left: left } }
      Insufficient e => { let n = Note.create(text: "declined")  return PaymentDeclined { available: amt - e.needed } }
    }
  }
}
```

```ts
// node — the rollback marker leaves the transaction; nothing is flushed or dispatched
  if (workflowResult.type === "PaymentDeclined") throw __rollback;
});
} catch (err) { if (err !== __rollback) throw err; }
if (!(workflowResult.type === "PaymentDeclined")) await __deferred.flush();
if (workflowResult.type === "PaymentDeclined") return httpCtx.json({ ...workflowResult, … status: 409 … }, 409, …);
```

(.NET rolls back the `IUnitOfWork` transaction and leaves the event deferral
unflushed; Java marks the `@Transactional` rollback-only, so no AFTER_COMMIT
listener sees its events; Python's 4xx answer rolls back the request
session.  Elixir refuses it, `loom.elixir-entry-result-unsupported`.)
