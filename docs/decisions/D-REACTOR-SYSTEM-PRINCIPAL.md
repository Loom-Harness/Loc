# D-REACTOR-SYSTEM-PRINCIPAL — event reactors run as a tenant-scoped system principal

**Status:** PINNED (owner ruling D1, 2026-09-29, eval closure review); **amended by D-TENANCY-FLAT** (2026-11-09): the event origin is `{tenant, causedBy}` — no `orgPath`, no `loomorgpath` attribute.

**Question.** A reactor — a workflow's event-triggered `create(e) by …`
starter or `on(e)` subscription, including one driven by a `timerSource`
tick or a broker-consumed event — has no request, so it has no request
principal. What does a gated operation it calls do? Before this ruling the
answer was five different defects (eval item 3): node, .NET and java emitted a
`currentUser` nothing declared (TS2304 / CS0103 / javac), python dropped the
operation's gate entirely (fail-open), elixir passed `nil` and crashed on
`nil.permissions`.

**Decision.** Reactors run as a **system principal**, tenant-scoped, and gates
are **evaluated against it** — never skipped.

- **The principal.** `{ isSystem: true, tenant: the triggering event's tenant,
  causedBy: the originating user's id }`. Every declared claim is EMPTY (the
  zero of its type — never the dev stub's `"admin"`), so no claims gate passes
  by accident. `causedBy` is for audit and logs only: it is not a language
  member and no gate can read it.
- **Language surface.** `currentUser.isSystem` (bool). A gate that admits a
  reactor says so: `requires currentUser.isSystem || …`. `isSystem` and
  `causedBy` are reserved claim names (`loom.user-reserved-field`).
- **Gates.** Evaluated normally. A reactor that reaches a gate the system
  principal can never satisfy — one that reads `currentUser` and never
  mentions `currentUser.isSystem` — gets a compile-time **warning**,
  `loom.reactor-gate-unsatisfiable`.
- **Tenancy.** Filters and stamps use the event's tenant. In-process, that is
  the tenant of the request that raised the event (the system principal copies
  the dispatching principal's tenancy claim and `orgPath`).
- **Timers.** A tick has no tenant, so a tenant-owned read from a timer-driven
  reactor must be explicitly cross-tenant: a `find` / inline `Repo.run` with
  `ignoring tenantOwned` (the language's existing cross-tenant read clause —
  `crossTenant` itself is an aggregate stance, not a read clause). Otherwise
  **error** `loom.timer-tenant-read`.

**Emission (all five backends).** The request principal is unchanged on the
wire (`/auth/me` projects the declared claims): node `User.isSystem?` /
`causedBy?` + `systemPrincipal()` in `auth/middleware.ts`; .NET init-only
`IsSystem` / `CausedBy` (serializer-skipped at default) +
`User.SystemPrincipal(origin)`; java trailing record components with a
claims-only constructor + `User.systemPrincipal(origin)`; python defaulted
dataclass fields + `system_principal()`; elixir `system_principal/0` in the
web `Auth` module, reading the origin the auth plug stashes in the process
dictionary. A reactor binds it only when its body — or an operation it calls,
hoisted gate included — reads `currentUser`
(`src/ir/util/system-principal.ts` `reactorNeedsPrincipal`).

**The event origin crosses the outbox and the broker (item 3 d).** In-process
the reactor's tenant is read off the dispatching request, but the outbox relay
and a broker consumer run long after that request is gone. So every backend
snapshots the raising frame's **event origin** — `{tenant, orgPath, causedBy}`
— where the event leaves it:

- **Outbox row:** under the reserved payload key `__loomOrigin`
  (`LOOM_OUTBOX_ORIGIN_KEY`, `src/util/channels.ts`) — inside the existing JSON
  `payload`, so the `__loom_outbox` schema does not change; every relay strips
  it before decoding the event.
- **Envelope:** the CloudEvents extension attributes `tenantid` (already in
  the optional set), `loomorgpath` and `loomcausedby` — each omitted when
  absent.
- **Delivery:** the relay (per drained row) and the channel consumer (per
  received envelope) open an ambient frame whose principal IS the system
  principal of that origin, so the reactor's gates, tenant filters and stamps —
  everything reading the ambient principal — see the event's tenant. No origin
  (an auth-less producer, a timer-raised event) ⇒ the frame is not opened and
  the reactor runs tenant-less, exactly as before (fail-closed).

A system principal propagates its own origin, so an event a reactor raises
keeps the FIRST user as `causedBy` through any number of hops. Per backend:
node `currentEventOrigin` / `systemPrincipalFor` / `runAsEventOrigin`
(`auth/middleware.ts`); .NET `User.CurrentEventOrigin` / `SystemPrincipalFor` /
`EnterEventOrigin` + `Auth/EventOrigin.cs` (and `RequestContext.ActorId`
answers a system principal's `CausedBy`); java `User.currentEventOrigin` /
`systemPrincipalFor`, `CurrentUserAccessor.runAsEventOrigin`,
`auth/EventOrigin.java`; python `current_event_origin` /
`system_principal_for` / `event_origin_frame` (`app/auth/user.py`); elixir
`current_event_origin/0` / `system_principal_for/1` / `with_event_origin/2`
(web `Auth`). Emitted only on a deployable with `auth: required`; an auth-less
one keeps the bare row and envelope byte-for-byte.

**Trust.** `tenantid` on the wire selects the tenant a consuming reactor runs
in. That is the same trust the broker already carries for the event itself: a
party that can publish onto a Loom channel can already forge any event; broker
auth (`channels.md` § Broker auth) is the boundary, not the attribute.

**Affects.** `docs/language-reference/17-auth.md` § Reactors; `docs/auth.md`;
`docs/tenancy.md`; `docs/workflow.md`; `docs/channels.md`;
`src/ir/validate/checks/reactor-principal-checks.ts`.
