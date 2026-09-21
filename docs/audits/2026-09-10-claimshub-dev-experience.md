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

**Status re-check 2026-09-13**, amended **2026-09-20**. Three of the four
defects had a fix in flight on 2026-09-13; **those PRs were still open, so every
claim below was still true of `main`.** D3 now has one too (#2965), which also
**corrects D3's own framing** — the defect is real, the remedy the section
proposed was not. Each defect carries its own status line. Per-defect status lives
here; the disposition row is
[`docs/new-plan/coverage.md`](../new-plan/coverage.md) § Audits.

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
is bypassable today even without `denyByDefault` turned on. *(Update
2026-09-20: D3 turned out NOT to need #2862 slice 1 — it is a discoverability
gap closed on its own in #2965, and the section's proposed remedy was wrong.
See the correction inside D3.)*

## Defects

### D1 (bug, confirmed live on `main` today) — scaffolded `softDelete` button ships a `tsc` error; `journey/04-saas.ddd` already has it

**Status 2026-09-13:** fix in flight — **[#2878](https://github.com/Loom-Harness/Loc/pull/2878)** (the one-line `?? ""` at the site named below, proved on react/vue/svelte against `journey/04-saas.ddd`). Open, not merged; the root-cause line below is unchanged on `main`.

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

**Status 2026-09-13:** fix in flight — **[#2884](https://github.com/Loom-Harness/Loc/pull/2884)** (a new `loom.unknown-user-claim` raised in phase ④ off the enumerable `user { }` claim set, rather than the IR-validate check this section looked for). Open, not merged; no such check exists on `main` today.

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

### D3 (discoverability gap — **this section's original framing was wrong; corrected 2026-09-20**) — `crudish`'s generic `update` bypasses hand-written `requires` gates on the same aggregate

**Status 2026-09-20:** fix in flight — **[#2965](https://github.com/Loom-Harness/Loc/pull/2965)**, which both closes the gap and rewrites this section. The **bypass below is real and still reproduces on `main`**; what was wrong was the *diagnosis and the proposed remedy* in the last paragraph, which is corrected in place below.

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

**Note (2026-09-13 addendum, still true):** #2877 landed
`with crudish(requires: <Policy>)`, which gives every crudish-emitted member a
member-level gate. It does **not** close this: the gate is per-member and
identical across create/update/destroy, and the update still writes every
field.

#### Correction (2026-09-20) — the mechanism exists; nothing pointed at it

This section originally proposed generalizing `writableUpdateFields`'s
*stamp-target* exclusion (`docs/capabilities.md`;
`stamp-request-no-leak-parity.test.ts`) to auto-exclude "any field also mutated
by a `requires`-gated operation", calling it the natural sequel to that working
test. **That was reviewed and rejected, and the premise behind it was false.**

Two things were wrong:

1. **Auto-exclusion would break the access matrix.**
   `docs/language.md` § "Field access modifiers" defines a *complete,
   authoritative* six-state matrix (`editable` default, `immutable`, `managed`,
   `token`, `internal`, `secret`) and says outright that it "is not prose that
   can drift from behaviour" — each column is a real projection function in
   `src/ir/enrich/wire-projection.ts`. A field with no modifier is **declared**
   `editable`: the author has said it participates in the update input.
   Silently overriding that adds an invisible seventh state — a field's wire
   participation would no longer be readable off the field; you would have to
   scan every operation body in the aggregate. The stamp exclusion is not a
   precedent for it: a stamp target is server-owned *by declaration*, which is
   why enrichment promotes it to `managed` outright.

2. **The state this section thought was missing already exists.** `immutable`
   is read ✓ / create ✓ / update ✗, and its enforcement is **purely wire-side**
   — no validator forbids `status := Approved` inside an operation body on an
   `immutable` field. Verified empirically rather than by grep: a `.ddd` with an
   `immutable` field assigned inside a `requires`-gated operation was generated
   and compiled on **all five backends**, each of which emits code that writes
   the field and compiles clean (node `tsc --noEmit`; .NET `dotnet build
   /warnaserror`; Java `gradle testClasses bootJar`; Python `mypy --strict`;
   Elixir `mix compile --warnings-as-errors`). Elixir was the one to check
   twice — `changeset-emit.ts` has `UPDATE_EXCLUDED_ACCESS = {token, internal,
   immutable}` — and its domain-operation path does **not** route through that
   update changeset: `approve_claim/3` does `Ecto.Changeset.change(%{}) |>
   force_change(:status, …)`, while `@update_fields` legitimately loses the
   column.

So `status: ClaimStatus immutable` is the whole fix: the client still reads the
field, `create` still seeds it, the generic `update` can no longer touch it,
and `approve()` still assigns it server-side. Both holes — the `requires` gate
and the `precondition` — close at once.

**D3 is therefore a diagnostics and discoverability gap, not a codegen bug.**
`immutable` is a discoverability trap here: an author who wants "only
`approve()` can change this" will never reach for a word that says the field
never changes, because it demonstrably *does* change. #2965 closes it with

- an **advisory** `loom.update-gate-suggestion` — a `ddd parse` `Suggestions:`
  hint (the `loom.index-suggestion` channel), naming the field, the guarded
  operation, and `immutable` as the remedy. Advisory, not an error: there are
  legitimate models where the author really does want the field editable.
  It fires twice on `docs/audits/models/claimshub-v3.ddd` (`Claim.status`,
  `Claim.assignedAdjuster`) and falls silent once those fields are marked.
- **docs** — `language.md`, `language-reference/03-domain-modeling.md`,
  `auth.md` and `scaffold-macros.md` now say plainly that `immutable`
  constrains the *client update input*, not domain assignment, and is the right
  modifier for a field owned by a guarded operation.

**Deliberately deferred second axis.** The advisory fires only on operations
carrying a `requires` gate. A field assigned by an operation carrying only a
`precondition` has the same state-machine bypass, but triggering on that would
fire on a large fraction of real models — every scaffolded aggregate that grows
any state transition. Recorded here as a deferred decision rather than silently
included or silently dropped.

### D4 (papercut — `policy` intentional-but-undiagnosed, `deny` likely an oversight)

**Status 2026-09-13:** fix in flight — **[#2883](https://github.com/Loom-Harness/Loc/pull/2883)**, which goes further than this section asks: rather than adding a special-cased diagnostic, it promotes `policy`, `deny` and six siblings (`of`, `allow`, `local`, `deep`, `global`, `persistence`) into `CommonSoftKeywords`, so `policy: Policy id` simply becomes a legal field name. Open, not merged — on `main` today both halves below still reproduce. **One half stays unfixed even after it lands:** the literal repro `operation deny()` is a *declaration* name, and `Operation.name` is `(ID | 'write')` — `operation state()` fails identically — so widening declaration names is a separate decision, pinned by a test there rather than silently left.

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
