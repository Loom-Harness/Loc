# Dev-experience audit — building an insurance-claims system end to end

Built `ClaimsHub`, an insurance-claims `.ddd`, as an ordinary user over three
iterations that simulate real rounds of feedback: an MVP (policies + claims,
scaffolded CRUD, no auth) → adjuster assignment + `requires` gates +
`auditable` + file-upload evidence + auth → multi-tenant by branch +
`versioned` + a `Payment` aggregate driven by an event-triggered `workflow`
+ `softDelete` on `Policy`. Each stage was `parse`d, `generate system`'d, and
had its emitted **backend and frontend actually `npm install` + `tsc
--noEmit`'d** — not just "generation succeeded". Models are under
`docs/audits/models/claimshub-v{1,2,3}.ddd`.

Re-verified on fresh `main` @ `93bc82d` (2026-09-10) right before filing this.

## Overlap — read before picking anything up

Three parallel dev-experience sessions ran the same exercise on other
domains: #2861 (Jira-like tracker), #2862 (e-shop), #2864 (freight
forwarding). Deduped against all three. **None of the following is
re-claimed here**, and none of the four defects below appear in any of
their claimed slices.

**D3 below is adjacent to #2862 slice 1** (crudish's `create`/`update`/
`destroy` carry no `requires`, which #2862 frames as "unsatisfiable under
`denyByDefault`"). D3 here is a narrower, `denyByDefault`-independent
angle: crudish's generic `update` mass-assigns fields that a **hand-written,
already-gated** operation on the *same aggregate* also writes, so the guard
is bypassable today even without `denyByDefault` turned on. Whoever picks up
#2862 slice 1 should look at both angles together — commented there.

## Defects

### D1 (bug, confirmed live on `main` today) — scaffolded `softDelete` button ships a `tsc` error; `journey/04-saas.ddd` already has it

The scaffold's Detail page wires the soft-delete button's mutation hook as:

```tsx
// generated: src/pages/policies/detail.tsx
const softDeletePolicy = useSoftDeletePolicy(policyById.data?.id);
```

but the hook is typed `useSoftDeletePolicy(id: string)` — every sibling hook
on the same page (`update`, `restore`) instead does `useUpdatePolicy(id ??
"")`. Result: `error TS2345: Argument of type 'string | undefined' is not
assignable to parameter of type 'string'`.

**Not specific to this model.** Regenerating the repo's own
`journey/04-saas.ddd` (which puts `softDeletable, softDelete` on a
scaffolded `Project`/`Task`) and running `tsc` on the emitted `web_app`
reproduces it today, on both aggregates:

```
src/pages/projects/detail.tsx(150,50): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
src/pages/tasks/detail.tsx(168,44): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
```

`journey/FINDINGS.md` Stage 4 claims the frontend "`tsc` clean (after fix)"
— that claim covers a *different*, already-fixed bug (internal-field leakage
in scaffold columns); it is no longer true of the file as a whole. Either a
regression since that doc was written, or a gap its own verification missed.

**Root cause**, `src/generator/_walker/primitives/controls.ts:237`:

```ts
// Optional-chain the receiver: on a byId/single detail page the receiver is
// the query `data`, which is `undefined` until the fetch resolves. ...
// Without the `?.`, React/Vue crash on mount dereferencing `.id` of pending data.
const idExpr = `${emitExpr(opRef.receiver, ctx)}?.id`;
```

The runtime reasoning is sound, but nothing coalesces the result the way
every sibling hook call on the same page does. A one-line `?? ""` fixes it
without losing the safety property (by click time `data` has always
resolved).

### D2 (bug, confirmed live on `main` today) — `currentUser.<undeclared-field>` compiles clean, breaks `tsc`; the comment claiming a safety net is wrong

Minimal repro (independent of the claims model):

```ddd
system CuTest {
  user { id: string
         role: string }
  subdomain S { context C {
    aggregate Widget with crudish {
      name: string
      operation touch() { requires currentUser.totallyBogusField == "x" }
    }
    repository Widgets for Widget { }
  }}
  ui WebApp with scaffold(subdomains: [S]) { }
  storage primary { type: postgres }
  resource appState { for: C, kind: state, use: primary }
  deployable api { platform: node, contexts: [C], dataSources: [appState], port: 3000, auth: required }
}
```

`ddd parse` → 0 errors. `ddd generate system` → 0 errors, writes the route
verbatim: `if (!(currentUser.totallyBogusField === "x")) throw new
ForbiddenError(...);`. `tsc`: `error TS2339: Property 'totallyBogusField'
does not exist on type 'UserClaims'.`

The real-world trigger: write `requires
currentUser.permissions.contains(permissions.claimsApprove)` and forget to
add `permissions: string[]` to the `user { }` block. Same result — clean
generate, broken `tsc`, no diagnostic pointing at the mismatch.

**Root cause**, `src/ir/lower/lower-expr.ts` `memberType()`, ~L2588-2596:

```ts
// `currentUser.<field>` — synthetic entity backed by the system's
// user block. ... Unknown members fall through to the string fallback;
// the validator will surface the broken reference with a friendlier message.
if (t.kind === "entity" && t.name === USER_SHAPE_NAME && env.user) {
  ...
  const f = env.user.fields.find((f) => f.name === name);
  if (f) return f.optional ? { kind: "optional", inner: f.type } : f.type;
  return { kind: "primitive", name: "string" };   // <-- silent fallback, no diagnostic
}
```

No such validator check exists anywhere under `src/ir/validate/` (grepped).
The comment describes a safety net that was never built. Note
`docs/new-plan/T3-security-governance.md` documents a related-but-different
fix — a bare `requires currentUser.permissions.contains(x)` used to fail to
type-check as `bool` at all; that fix made *valid* member access type
correctly, it never added a check that the member exists. This is a live gap
next to, not covered by, that work.

### D3 (design gap, no diagnostic — adjacent to #2862 slice 1) — `crudish`'s generic `update` bypasses hand-written `requires` gates on the same aggregate

```ddd
aggregate Claim with crudish, auditable {
  status: ClaimStatus
  operation approve() {
    requires currentUser.role == "admin" || currentUser.permissions.contains(permissions.claimsApprove)
    precondition status == UnderReview
    status := Approved
  }
}
```

The emitted `POST /claims/{id}/update` route (from `crudish`) has **no
`requires` at all** and calls a domain `update()` that blind-assigns every
field, `status` included, with no gate and no precondition. Any
authenticated caller can `POST /claims/{id}/update {"status":"Approved"}`
and skip the adjuster-role check on `approve()` entirely — independent of
whether `denyByDefault` is on. This is the first thing you'd hit once a
scaffolded aggregate grows a guarded state-machine operation on top of
`crudish`, which is a very common progression.

Loom already solved the adjacent problem: `docs/capabilities.md` documents
that `crudish`'s `update` deliberately excludes *stamp* targets
(`createdBy`, etc.) from its writable fields so a row-security stamp can't
be mass-assigned around (`writableUpdateFields` /
`stamp-request-no-leak-parity.test.ts`). The same mechanism was never
generalized to "a field also mutated by a `requires`-gated operation
shouldn't be blanket-writable via the generic update" — this would be the
natural sequel to that existing, working test.

### D4 (papercut — `policy` intentional-but-undiagnosed, `deny` likely an oversight)

- A field literally named `policy` fails to parse:
  `` Expecting token of type '}' but found `policy` ``. **Intentional** —
  `docs/language-reference/01-lexical-structure.md` lists `policy` as "soft
  only as `LooseName`" (parameter/arg names), not a field name
  (`ddd.langium` `Property.name` vs `LooseName`). But the parse error gives
  no hint why, and `policy` is about the most obvious field name in this
  entire domain. A special-cased diagnostic ("`policy` is reserved for the
  authorization block; pick a different field name") turns a confusing wall
  into a one-line fix.
- `operation deny()` fails outright — `deny` isn't in `LooseName` at all,
  unlike its grammar sibling `allow` (`ddd.langium` `PolicyEffect:
  effect='allow' ... | effect='deny' ...`, but only `'allow'` was added to
  `LooseName`). Looks like a plain asymmetry/oversight, not a deliberate
  scoping choice — `allow`/`deny` is as natural a verb pair as
  `approve`/`reject`.

## What worked (most of the surface)

- The zero-arg-`criterion`-not-queryable bug (`journey/FINDINGS.md` Friction
  #3) no longer reproduces — confirmed fixed on fresh `main`.
- Event-triggered workflow guardrails are excellent: a first attempt at
  `create(e: ClaimApproved) by e.claim` with no correlation field and no
  `channel` was rejected at **`parse` time** with two precise, actionable
  messages (`loom.workflow-correlation-required`,
  `loom.reactor-event-uncarried`).
- `tenantOwned` + `auditable` + `versioned` + `softDeletable` composed
  cleanly on the same aggregate; backend `tsc`'d clean including the tenant
  read-filter, optimistic-concurrency 409 path, and audit-stamp wiring —
  zero hand-threading.
- `money` as a bare field primitive (no wrapper value object) is a clean fit
  for premiums/claim amounts.
- `File` fields + scaffolded `FileUpload`/`FileLink` + `objectStore`/
  `localDisk` wiring worked first try with zero hand-written page code.
- The index-suggestion advisory and the bespoke-finder-discourages-you
  warning both fire exactly as documented.

## Scope not covered

No docker-compose boot / runtime e2e (only static `tsc --noEmit` on `api`
and `web_app`). Only node+react exercised — no other backend/frontend, no
i18n.
