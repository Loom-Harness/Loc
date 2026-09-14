# Loom evaluation — findings

Severity: **S1** data loss / broken isolation / doesn't compile or boot on a
needed path / silently wrong · **S2** blocked or expensively worked around, or a
headline claim materially untrue · **S3** repeated friction · **S4** polish or a
documented limitation.

Class: **SILENT** (valid input, exit 0, output wrong/stubbed/uncompilable) ·
**HONEST** (refused with a clear diagnostic) · **DOCUMENTED** (named up front).

---

## F-001 · S1 · SILENT — a value object declared inside one context and used from another emits uncompilable C#

**Claim under test.** README: "Five backends from one source … Identical API
contracts; idiomatic per-runtime output." The README's own Quick Example
declares three backend deployables including `platform: dotnet`.

**Repro.**
1. `sed -n '62,156p' README.md > eval/phase0/readme-quick.ddd` (the README's
   own Quick Example, verbatim).
2. `node bin/cli.js parse eval/phase0/readme-quick.ddd` → `0 error(s), 0 warning(s).`
3. `node bin/cli.js generate system eval/phase0/readme-quick.ddd -o eval/phase0/out`
   → `0 error(s), 0 warning(s). Wrote 226 file(s)`, exit 0.
4. `docker compose up -d --build` →
   ```
   /src/Application/Products/Responses/ProductResponses.cs(10,148): error CS0246:
   The type or namespace name 'MoneyResponse' could not be found
   ```

**Observed vs expected.** `valueobject Money` is declared inside
`context Orders`. The .NET emitter writes `public sealed record MoneyResponse`
into `namespace Acme.Application.Orders.Responses` only. `Product` lives in
`context Products`, so `ProductResponses.cs` references `MoneyResponse` with no
`using` for that namespace and no local declaration. Expected: compilable C#,
or a validator error at generate time.

**Minimal repro:** `eval/repro/F001-dotnet-shared-vo.ddd` (22 lines).
```
node bin/cli.js generate system eval/repro/F001-dotnet-shared-vo.ddd -o /tmp/f1
grep -rn "MoneyResponse" /tmp/f1/api_net/Application/*/Responses/*.cs
```
Declared once in `Application/Alphas/Responses/`; referenced undefined from
`Application/Betas/Responses/`.

**Scope, narrowed by experiment.**
- Two aggregates in the *same* context sharing a VO → the record is emitted into
  **both** namespaces. Compiles. (`/tmp/f1b`)
- A **root-level** (shared-kernel) VO used by two contexts → emitted into both.
  Compiles. (`/tmp/f1c`)
- A VO declared **inside context A**, used by an aggregate in **context B** →
  **dangling reference**. (`/tmp/f1`)

**It is not a .NET bug — it is a cross-target emission bug.** One `.ddd`
(`/tmp/f1fe.ddd`, all 5 backends × 6 frontends) generated with 0 errors:

| Target | Cross-context VO | Evidence |
|---|---|---|
| node (Hono) | OK — shared `domain/value-objects.ts` | inspected |
| python | OK — shared `app/http/wire_models.py` | inspected |
| java | OK — duplicated per feature package | inspected |
| elixir | OK — shared `api/schemas/money.ex` | inspected |
| **dotnet** | **BROKEN** | `error CS0246: … 'MoneyResponse' …` from `dotnet publish` |
| **react** | **BROKEN** | `error TS2304: Cannot find name 'MoneySchema'` from `npm run build` |
| **vue** | **BROKEN** (same shape) | `web_v/src/api/beta.ts:21` uses `MoneySchema`, 4 imports, none of it |
| **svelte** | **BROKEN** (same shape) | `web_s/src/lib/api/beta.ts:8,24` same |
| **angular** | **BROKEN** (same shape) | `web_a/src/api/beta.ts:10` uses `MoneyResponse`, declared only in `alpha.ts` |
| feliz / flutter | unverified | no `Money` emission found to inspect |

Two of the nine (dotnet, react) are confirmed by a **real compiler**; three
(vue, svelte, angular) are confirmed by inspection of the emitted text only —
I did not stand up their toolchains.

**Workaround.** Hoist every shared value object to the model root. Cheap once
known — but nothing tells you, and the vendor's own front-page example is on
the wrong side of it.

**Adoption impact.** The failure mode is what matters more than the bug: a
100%-clean `parse`, a 0-error `generate`, and a build that dies three minutes
later inside a container, with a C# error that names no `.ddd` line. Any gate a
team builds on `ddd parse`/`generate` exit codes is blind to it.

**Time lost:** 35 min (initially attributed to the sandbox's TLS proxy, which
was failing at the same step for an unrelated reason).

---

## F-002 · S2 · HONEST — the "home feed" (posts by people I follow) is not expressible as a query

**Claim under test.** README at-a-glance / docs: `projection` is the read-model
surface, with `join` and `where`. Commons needs "posts from people I follow,
newest first, paginated" — the single most ordinary query in a social product.

**Repro.** `eval/probe/feed-a.ddd`:
```ddd
projection HomeFeed {
  postId: Post id   title: string
  from Post as p
  where f.follower == currentUser.id
  join Follow as f on p.author
  select postId = p.id, title = p.title
}
```
```
loom.projection-where-not-queryable Community/HomeFeed: projection 'HomeFeed':
where-clause is not queryable (member access not rooted at 'this' or beyond a
flattened value object).
```

**Observed vs expected.** Documented and enforced: a projection `join` is "a
by-id follow … an app-level bulk load by id **after** the source query", so the
`where` can only filter the *source* table. A filter over the joined table — the
entire point of a feed query — cannot be pushed into SQL and is refused. The
queryable subset also excludes `IN (subquery)` over another aggregate, so there
is no in-DSL spelling of "authors ∈ (my followees)".

This is an **HONEST** gap and a good diagnostic. It is still S2 because the
workaround is architectural, not syntactic — see F-00X (escape hatch cost).

**Workaround.** Denormalise: model the feed as a **folded projection**
(`keyed by member` + `on(PostPublished)`) and fan out a row per follower at
write time, i.e. hand-build a materialised feed table. That is the right answer
at scale, but it is a design forced by the DSL's read ceiling rather than
chosen, and it makes "posts from people I follow" cost a fan-out write on every
post. A relational backend would have served it with one indexed join.

**Adoption impact.** Set expectations correctly: Loom's read language covers
single-table filters, by-id follows, and group-by aggregation. Any read whose
selectivity lives in a *related* table needs a materialised read model. Budget
for that in the domain design, not as a later optimisation.

**Time lost:** 20 min.

---

## F-003 · S1 · SILENT — the generator emits an e2e suite that calls routes it did not generate

**Claim under test.** README: "`ddd generate system acme.ddd -o ./out` →
runnable multi-project tree + `docker-compose.yml` + healthchecks + generated
migrations + **e2e suite**. `docker compose up -d` → everything running."

**Repro.**
1. Generate the README Quick Example (F-001 workaround applied so it builds):
   `node bin/cli.js generate system eval/phase0/readme-quick-fixed.ddd -o eval/phase0/out2`
   → `0 error(s), 0 warning(s)`.
2. `docker compose up -d --build db api api_net web_app` → all four healthy.
3. The generated OpenAPI for the node backend lists **six** routes:
   ```
   GET /api/orders          GET /api/orders/{id}
   POST /api/orders/{id}/add_line   POST /api/orders/{id}/confirm
   GET /api/products        GET /api/products/{id}
   ```
   There is no `POST /api/orders` and no `POST /api/products`.
4. The generated `e2e/Acme.e2e.test.ts:86-87` does:
   ```ts
   const prod = await __post(`${base}/api/products`, …);
   const ord  = await __post(`${base}/api/orders`, …);
   ```
5. Run it (copied outside the repo, see F-004): **3 failed / 3**
   ```
   Error: POST http://localhost:3000/api/products → 405 Method Not Allowed
   ```

**Observed vs expected.** The README source declares no `create` action and no
`crudish` on `Order`/`Product`, so no POST route is emitted — which is correct
and documented. But the *same compilation* lowers `api.products.create({…})` in
the `test e2e` block into a POST against that absent route, and reports nothing.
Expected: a validation error ("`test e2e` calls `products.create` but `Product`
declares no create action"), which the compiler is in a position to give — it
holds both halves in one IR.

**Two claims land on this.** The Quick Example is the README's proof that the
whole pipeline works, and its own e2e test cannot pass against its own output.
And "Generated end-to-end tests against the live stack" is sold as the
quality story.

**Workaround.** Add `with crudish` (or an explicit `create`) to every aggregate
an e2e test constructs. Trivial *once you know*; the failure surfaces only when
you run the suite against a booted stack.

**Adoption impact.** This is the shape that worries me most: two emitters that
disagree, with a green `parse` and a green `generate` between them. A team
wiring `ddd generate` into CI and treating exit 0 as "the system is coherent"
gets no signal. The DSL is meant to remove exactly this class of drift — it is
the "no drift between layers" claim, failing between the API layer and the test
layer of one model.

**Time lost:** 25 min.

---

## F-004 · S3 · SILENT — the generated e2e project has no vitest config and inherits an ancestor's

**Repro.** `cd <out>/e2e && npm install && npx vitest run` inside a directory
tree that has a `vitest.config.ts` above it → `No test files found, exiting
with code 1`, and vitest prints the *ancestor project's* include globs. Copy
the same `e2e/` to `/tmp` and it runs.

**Observed vs expected.** `<out>/e2e/` ships `package.json`, `tsconfig.json` and
the spec, but no `vitest.config.ts`, so vitest's upward config search escapes
the generated project. Expected: a self-contained project, since the output
tree is explicitly meant to be dropped into a repo (which is exactly where an
ancestor config lives).

**Adoption impact.** Costs 20 minutes and reads as "the generator emitted no
tests" rather than "config resolution escaped". Trivial fix, real confusion.

**Time lost:** 15 min.

---

## F-005 · S1 · SILENT (crash) — a permission check in a list-read gate crashes the generator when a UI is mounted

**Claim under test.** `docs/auth.md`: the `permissions { … }` catalogue with
`currentUser.permissions.contains(permissions.x)` is the canonical
authorization check; `docs/scaffold-macros.md` §`requires:` prescribes a named
function-form `policy` as *the* way to satisfy `denyByDefault`. The README sells
the whole authorization layer plus six frontends off one model.

**Repro.** `eval/repro/F005-ui-gate-crash.ddd` + a gated list read:
```ddd
repository Things for Thing {
  find all(): Thing[] requires CanManage()     // CanManage(): bool = currentUser.permissions.contains(permissions.manage)
}
```
```
$ node bin/cli.js parse /tmp/f5c.ddd
0 error(s), 0 warning(s).                       <-- accepted
$ node bin/cli.js generate system /tmp/f5c.ddd -o /tmp/f5c
0 error(s), 0 warning(s).                       <-- validation passes
Error: UI gate: expression kind 'call' is not supported in a UI gate.
    at renderGateExpr (out/generator/_frontend/gate-expr.js:63:19)
    at renderPageGate (out/generator/react/walker/page-shell.js:551:24)
    …
EXIT=1
```
No `loom.*` code, no `.ddd` file:line, no partial output — an unhandled
exception out of the emitter.

**Scope, narrowed by experiment.**

| Gate expression on `find all()` | Result |
|---|---|
| `requires CanManage()` (named function-form `policy`) | **crash** |
| `requires currentUser.permissions.contains(permissions.manage)` (inline, the docs' canonical form) | **crash** |
| `requires currentUser.role == "admin"` (bare comparison) | generates |
| the same policy call on a non-`all` find (`find byName … requires CanManage()`) | generates |
| the same policy call on an `operation` / `crudish(requires: …)` | generates |
| `workflow FanOutPost requires CanMod() { … }` (workflow header gate) | **crash** |

So the trigger is precisely: **any gate that becomes a scaffolded *page*'s
route gate — the aggregate list read, and the workflow instance read — is
rendered by a UI gate renderer that supports only a comparison expression.**
Any call, including the one the docs lead with, throws.

**The compiler prescribes the crash.** Under `enforcement: denyByDefault`, an
`audited` aggregate raises:
```
loom.audit-history-ungated: … Declare `find all(): Report[] requires <expr>` on
'Reports'; history inherits that gate
```
and for a workflow:
```
loom.default-deny-ungated: … Add a `requires <expr>` to the workflow header
```
Doing exactly that, with the permission check the auth docs teach, crashes the
generator in both cases. Compiler-authored instructions that cannot be
satisfied with compiler-recommended syntax.

**Workaround.** Reduce every list-read gate to a comparison over a single
`currentUser` scalar (`currentUser.role == "admin"`). That flattens a
permission model with an `implies` closure into stringly-typed role equality at
exactly the endpoints — list reads and audit history — where you least want it,
and it diverges from the gate spelling used everywhere else in the same file.

**Adoption impact.** Directly blocks the recommended security posture
(`denyByDefault` + `permissions`) on any system with a frontend, which is the
advertised shape. Found within an hour of modelling, on the first realistic
auth wiring I attempted. That it is an uncaught `throw` rather than a
`loom.*` diagnostic also means it cannot be discovered by `parse` in an editor
or a pre-commit hook — only by running a full `generate`.

**Time lost:** 40 min (30 of it bisecting, because the crash names no `.ddd`
construct — the message says "a UI gate" and the model has no `ui` gate in it).

---

## F-006 · S2 · DOCUMENTED (but a trap in combination) — `enforcement: denyByDefault` does not gate list reads

**Claim under test.** `docs/auth.md`: "Under `denyByDefault`, every
**client-reachable command AND read** on an `auth: required` deployable must
declare a `requires` gate … else `loom.default-deny-ungated` fires."

**Repro.** Commons (`eval/commons/s4.ddd`) declares
`auth { enforcement: denyByDefault }`, every deployable `auth: required`, and
passes validation with 0 errors. Booted stack; minted a Keycloak user `bob`
with **no role claim and no permissions at all**:
```
GET /api/members       -> 200      GET /api/reactions     -> 200
GET /api/posts         -> 200      GET /api/medias        -> 200
GET /api/comments      -> 200      GET /api/notifications -> 200
GET /api/groups        -> 200      GET /api/reports       -> 403
GET /api/follows       -> 200      GET /api/bans          -> 403
```
8 of 10 aggregate list reads open to any authenticated caller. The two that are
closed are the only two where I hand-declared `find all(): T[] requires …`.

**Observed vs expected.** This *is* documented — same page, further down: "The
auto-injected `find all` list route is the one exception: it is
compiler-synthesized with no author source line, so it is out of default-deny
scope." So the claim and the carve-out sit in the same document, and the
carve-out wins. Expected, for a setting named `denyByDefault`: deny.

**Why it is S2 and not S4.** Because of how it composes with **F-005**. The
documented remedy is to declare `find all(): T[] requires <expr>` — and doing
that with the permission check the same doc teaches **crashes the generator**
on any system with a frontend. So on the advertised shape (backend + UI +
`denyByDefault` + `permissions`), the choices are: leave every list read open,
or degrade every list gate to a `currentUser.<scalar> == "literal"` comparison.
For Commons that means the entire social graph (`/api/follows`), every member's
notifications, and every members-only/group-only comment are enumerable by any
signed-in account.

**Adoption impact.** `denyByDefault` is exactly the control a security reviewer
will point at to sign off. It gives a strong, exhaustive, per-endpoint report at
compile time for *commands*, and nothing for *list reads*. A team that reads
the headline and not the carve-out ships an enumerable API.

**Time lost:** 30 min.

---

## F-007 · S3 · SILENT — the MIT `LICENSE` over generated code is not emitted by `ddd generate`

**Claim under test.** README §License, verbatim: "The **code Loom generates**
(everything `ddd generate` writes into `<outdir>/`) is licensed to you under the
**MIT License** — the CLI emits a `LICENSE` file at the output-directory root
that says so explicitly."

**Repro.**
```
$ find eval/commons/out    -maxdepth 2 -name 'LICENSE*' -not -path '*/node_modules/*'   # -> nothing
$ find eval/phase0/out2    -maxdepth 2 -name 'LICENSE*' -not -path '*/node_modules/*'   # -> nothing
$ node bin/cli.js new newproj --platform node --template crud && head -1 /tmp/newproj/LICENSE
MIT License
```
`ddd new` emits it. `ddd generate` does not.

**Contradicted by the vendor's own docs.** `docs/tools.md:110` says plainly:
"`ddd generate` writes none of these: it emits build output into a tree whose
identity files are yours". So `tools.md` is correct and the README is wrong.

**Adoption impact.** Small engineering-wise, non-trivial for procurement. The
permissive grant over the artifact you actually ship is asserted only in the
*vendor's* README, under an FSL-licensed repo, and is absent from the artifact.
Legal will ask for it in writing; get the grant into a contract or a file that
ships in `<outdir>/`, don't rely on this sentence.

**Time lost:** 10 min.

---

## F-008 · S2 · DOCUMENTED contract, SILENT drift — hand-edits are clobbered without warning; pinning them freezes the file forever with no drift detection

**Claim under test.** README: "The keys to the codebase … full ownership of
every line that's generated", "Zero vendor lock-in".

**Repro.**
1. Hand-edit `<out>/api/http/member.routes.ts` (added a rate-limit bucket —
   rate limiting is not expressible in the DSL) and append a line to
   `<out>/docker-compose.yml`.
2. `node bin/cli.js generate system … -o <out>` → `Wrote 2 file(s), unchanged: 219`.
   Both edits gone. No warning, no backup, no mention that the on-disk content
   differed from what was last generated.
3. `--dry-run` does distinguish: it prints `write` for those two and `unchanged`
   for the other 219 — but `write` reads as "new file", not "your edits die here".
4. Pin it: `.loomignore` containing `api/http/member.routes.ts` → regenerate →
   `skipped (.loomignore): 1`, edit survives. The hatch works.
5. **The cost.** With the file still pinned, make an *additive* model change
   (`+pronouns`, `+timezone` on `Member`) and regenerate:
   `Wrote 23 file(s), unchanged: 201, skipped (.loomignore): 1`.
   - `db/schema.ts`, `member-repository.ts`, the migration: **all know** the new fields.
   - the pinned `member.routes.ts`: **0 occurrences** of `pronouns`. Its
     `UpdateMemberRequest` zod schema still has the old four fields.
   The DB gained a column, the repository writes it, the API cannot accept it —
   and the only signal is the integer `1` in `skipped (.loomignore): 1`. It does
   not name the file, and nothing checks whether a pinned file has gone stale.

**Observed vs expected.** The overwrite contract is stated honestly and
up-front (`docs/tools.md`: "**every file Loom generates is overwritten on every
run**"), which is why the *contract* is DOCUMENTED. The **drift** is SILENT: the
product's headline is "no drift between layers", and the supported escape hatch
manufactures exactly that drift, permanently and without a detector.

**What "you own the source" actually means.** You own it the way you own a
build artifact: you can read it, fork it, and leave with it. You cannot edit it
and keep regenerating. Every customisation is one of — change the model, pin the
file and accept permanent divergence, or fork the generator (FSL-licensed).

**Adoption impact.** This is the structural one, not a bug. Plan for a
`.loomignore` review in code review, and a CI check that pinned files are
re-reviewed whenever their aggregate changes — Loom will not tell you.

**Time lost:** 25 min.

---

## F-009 · S2 · HONEST — an aggregate cannot be moved between bounded contexts without dropping its table

**Claim under test.** Loom is "a Langium-based DSL for Domain-Driven Design".
Moving an aggregate into the right bounded context is the canonical DDD
refactor, and `docs/migrations.md` advertises a rename ledger including
"**Table / aggregate rename** … A bare `OldName -> NewAggregate` step".

**Repro.** `eval/evo/mv1.ddd` → `mv2.ddd` moves `aggregate Thing` from
`context C` to `context D` (tables are schema-per-context: `c.things` → `d.things`).
```
migration for module "S" contains 1 destructive change(s):
  - DROP TABLE c.things
```
Attempts to express it safely:
| Attempt | Result |
|---|---|
| `migration "m" { Thing -> Thing }` | `error: Table rename 'Thing -> Thing' names the same aggregate on both sides` |
| rename on the move: `migration "m" { Thing -> Widget }` + `Widget` in context D | still `DROP TABLE c.things` |

The ledger keys on the **aggregate name**, not the schema, so there is no
spelling for "same aggregate, different context". Remaining options:
`--allow-destructive` (drops the table and all its rows) or hand-written SQL
outside the toolchain.

**Observed vs expected.** The destructive gate correctly refuses and nothing is
silently destroyed — that is why this is HONEST, and it is the right failure.
But the safe path does not exist, on the refactor a DDD tool most needs to
support.

**Adoption impact.** Getting context boundaries wrong is normal and expected in
year one; a DDD tool should make fixing them cheap. Here, correcting a context
boundary on a populated table is a hand-written data migration. Treat context
boundaries as expensive-to-change and spend real design time on them up front —
the opposite of the "start fast, refactor later" posture the product sells.

**Time lost:** 20 min.

---

## F-010 · S3 · HONEST — `elastic` / `meilisearch` are advertised storage types that no resource kind accepts

**Claim under test.** `docs/language.md:235` and `docs/architecture.md:88` list
`elastic` / `meilisearch` under **Search** as built-in sourceTypes that
"activate dev-compose sidecars + client emission per the kind × sourceType
matrix".

**Repro.** `storage searchIdx { type: meilisearch }` parses. Binding it to a
resource, with every one of the nine documented kinds:
```
kind=state|cache|eventLog|snapshot|objectStore|queue|api|mailer|replica
  -> error: resource 'cSearch' kind '<k>' is incompatible with storage
     'searchIdx' of type 'meilisearch'.
```
No kind accepts it. `docs/resources.md` — the doc the matrix is said to live in
— contains no occurrence of "search", "elastic" or "meilisearch".

**Why it mattered here.** Commons requires "search across posts". Without a
search store, in-DSL search is what the queryable subset allows:
`this.title.startsWith(q)` — a prefix match on one column.
`this.title.contains(q)` is rejected (`loom.find-where-not-queryable`,
"non-queryable intrinsic '.contains'"). There is no substring, no full-text, no
relevance, no multi-column search.

**Workaround.** Index outside Loom: consume the outbox/channel stream into your
own search service and serve `/search` from a hand-written deployable. That is a
sensible architecture — but it is the first thing outside the model, and the
model can't even name the store.

**Adoption impact.** Grade the storage matrix as "postgres is real, the rest
needs checking one cell at a time". Every non-postgres sourceType a design
depends on should be probed with a 10-line `.ddd` before it is designed in.

**Time lost:** 15 min.

---

## F-011 · S3 · SILENT (docs) — reference docs show comma-separated syntax the grammar rejects

**Repro.** Three, hit in one afternoon of modelling from the reference:

| `docs/language.md` shows | Reality |
|---|---|
| `user { id: string, role: string, … }` (line 230) | `error: Expecting token of type '}' but found ','` — newline-separated only |
| `channel Name { carries: [Event, …], … }` (line 325) | `error: Expecting token of type 'ID' but found '['` — `carries: A, B` bare, no brackets |
| `retrieval Name of Agg { where: …, sort: […], loads: […] }` (line 320) | `error: Expecting token of type '}' but found ','` |

Each costs a parse-error round trip, and the diagnostic points at the *next*
line, not the offending one. Separately, a field-modifier order slip
(`erased: bool = false internal` instead of `bool internal = false`) reports at
the following line too: `:31:9 error: Expecting token of type ':' but found 'derived'`.

**Adoption impact.** Low individually, steady in aggregate — the reference is
the thing a new team member reads, and it is wrong in the small at a rate of
roughly one syntax per hour of first-day modelling. `docs/language.md`'s own
lexical section warns "When in doubt, **use newlines**: they are accepted
everywhere", which is the correct advice its own examples don't follow.

**Time lost:** 20 min cumulative.

---

## F-012 · S2 · HONEST — group-scoped visibility is not expressible; row-level "own rows" is

**Claim under test.** Commons requires per-item visibility
(public / members-only / group-only) and Loom advertises capability `filter`s
that "install at the query layer".

**Repro.** `eval/probe/visibility*.ddd`, `eval/probe/rowlevel.ddd`:

| Filter | Result |
|---|---|
| `filter this.visibility == Public` | OK — installs on every read |
| `filter this.visibility == Public \|\| this.author == currentUser.memberId` | OK (needs the claim typed `Member id` in `user { }`, not `string`) |
| `filter … \|\| this.group.members.contains(currentUser.memberId)` | `loom.criterion-not-selectable` — "must lower to the queryable subset" |

So "public" and "mine" are enforced in SQL on every read, by construction, on
every backend — genuinely good. "Visible to members of the owning group" is a
one-level join and cannot be said at all.

**Workaround.** Denormalise group membership onto the post (an
`allowedGroups: Group id[]`… which `.contains` *is* admitted for, as a join-table
`EXISTS`) or maintain a per-post ACL column — and keep it consistent yourself on
every membership change, which the DSL will not do for you.

**Diagnostic quality note.** With no `user { }` block in scope, the same filter
reports `loom.criterion-not-selectable … member access not rooted at 'this'`
rather than "there is no `currentUser` here" — which sent me looking at the
wrong half of the expression for ten minutes.

**Adoption impact.** Same shape as F-002: Loom's authorization filters are
single-table predicates. Any rule whose truth lives in another table must be
denormalised into the row being read. Decide that at design time.

**Time lost:** 25 min.


---

## F-013 · S1 · SILENT (crash) — a `for` loop in a workflow reactor crashes the Elixir emitter

**Claim under test.** README: "Five backends from one source". `docs/language.md`
documents the diagnostic family `loom.platform-*` / `loom.*-unsupported-backend`
as "**Honest** per-backend gaps — the feature parses but the selected target
cannot emit it". This gap is not honest; it is an uncaught throw.

**Repro.** `eval/repro/F013-elixir-foreach-crash.ddd` (34 lines) — the Commons
notification fan-out: a reactor that loops over an aggregate array.
```ddd
workflow FanOut {
  postId: Post id
  on(e: PostPublished) by e.post {
    for f in Follows.run(FollowersOf(e.author)) {
      let n = Note.create({ member: f.follower, post: e.post })
    }
  }
}
```
```
$ node bin/cli.js parse    …                      -> 0 error(s), 0 warning(s).
$ node bin/cli.js generate system … (elixir)      -> 0 error(s), 0 warning(s).
Error: dispatch-emit: unsupported reactor statement kind 'for-each'
    at renderHandler (out/generator/elixir/dispatch-emit.js:378:38)
EXIT=1
$ sed 's/platform: elixir/platform: node/' … | generate   -> Wrote 54 file(s)
```
Same model: node generates, elixir throws. No `loom.*` code, no `.ddd` location,
no partial output — the whole `generate system` run dies, so **every other
deployable in the system fails to emit too**.

**Why it happens (confirmed in Phase 6).** `docs/new-plan/testing-quality-improvement-plan.md:73`
describes `src/generator/_workflow/stmt-target.ts` — the shared 10-kind
`WorkflowStmtIR` spine that owns "the only `for-each`/`if-let` recursion" — as
"shared by the **Hono/.NET/Java/Python** workflow emitters". Elixir is not on
that list; it has its own `dispatch-emit.ts`, which lacks the arm.

**Impact on the evaluation.** This is why the Commons breadth model could not be
generated for Elixir at all — one unsupported statement kind in one reactor took
down the emission of a 1148-file, 9-target system.

**Workaround.** Don't host that context on elixir, or restructure the fan-out to
avoid a loop (which, for a fan-out, means not doing it in the model).

**Adoption impact.** Treat "five backends" as a per-feature claim, not a global
one, and probe each backend against your actual model early. The failure is loud
(exit 1) rather than silent-in-production, which is the mitigating factor — but
it is a crash where the project's own documented diagnostic family belongs.

**Time lost:** 20 min.

---

## F-014 · S1 · SILENT — a value object named `Money` skips construction validation and emits uncompilable code

**Claim under test.** "Validation gates catch hallucinated fields and
out-of-scope references **before any code is emitted**" (README, LLM-safe).
`docs/language.md` documents `loom.construction-missing-field` for
"a construction that omits a **required** field".

**Repro.** `eval/adversarial/05-missing-ctor-field.ddd` — omit `currency` when
constructing the value object:
```ddd
valueobject Money { amount: money  currency: string }
…
operation bump(by: int) { precondition by > 0  price := Money { amount: money("1.00") } }
```
```
$ node bin/cli.js parse  …   -> 0 error(s), 0 warning(s).
$ node bin/cli.js generate … -> 0 error(s), 0 warning(s). Wrote 43 file(s)
$ grep -n 'new Money' /tmp/adv05/api/domain/item.ts
40:    this._price = new Money(new Decimal("1.00"));       # ctor takes (amount, currency)
$ cd /tmp/adv05/api && npx tsc --noEmit
domain/item.ts(40,19): error TS2554: Expected 2 arguments, but got 1.
```

**The trigger is the name.** Same model, same omission, renaming only the
value object:
```
valueobject Money    -> 0 error(s), 0 warning(s).            <-- check skipped
valueobject Cash     -> error: 'Cash' construction is missing required field: currency.
valueobject Monies   -> error: 'Monies' construction is missing required field: currency.
valueobject money2   -> error: 'money2' construction is missing required field: currency.
valueobject MONEY    -> error: 'MONEY' construction is missing required field: currency.
```
Every name is checked except the literal identifier `Money` — which is the name
used in the README's Quick Example, in `docs/language.md`'s "complete example",
and in `examples/sales.ddd`, `banking.ddd`, `inventory.ddd` and
`money-primitive.ddd`. It is the single most-used value-object name in the
product, and it is the one where the gate does not fire. (`money` is a
primitive type name; the collision with the user-declared `Money` VO is the
plausible cause, but I did not read the source to confirm — Phase 5 rule.)

**Amplifier: the generated build does not type-check.** `docker compose build
api` on the broken output **succeeds** — the generated `package.json` builds
with `tsup` (esbuild), which strips types without checking them. `tsc --noEmit`
exists as a separate `typecheck` script that the Dockerfile never runs. So
type-broken generated TypeScript builds a clean image, boots healthy, and fails
at the first call to that operation (`currency` undefined → NOT NULL violation,
or an invariant on `currency.length` throwing).

**Adoption impact.** This is the worst failure shape in the evaluation: four
green gates in a row (`parse`, `generate`, `docker build`, healthcheck) and a
defect that only appears when a user hits that code path in production. It
also directly contradicts the "LLM-safe by construction" pitch — the stated
mechanism is that validation catches bad constructions before emission, and
here it doesn't, on the example the LLM would have been trained on.

**Workaround.** Do not name a value object `Money`. Add `tsc --noEmit` to your
own CI over the generated tree — do not rely on the generated Dockerfile.

**Time lost:** 30 min.

---

## F-015 · S1 · SILENT — an aggregate field named `state` emits uncompilable C#

**Repro.** `eval/repro/F015-dotnet-state-field.ddd` (14 lines):
```ddd
aggregate Thing with crudish {
  state: string
  derived display: string = state
}
deployable apiNet { platform: dotnet, … }
```
```
$ node bin/cli.js parse    … -> 0 error(s), 0 warning(s).
$ node bin/cli.js generate … -> Wrote 58 file(s)
$ docker compose build api_net
/src/Domain/Things/Thing.cs(16,19): error CS0102: The type 'Thing' already contains a definition for 'State'
/src/Domain/Things/Thing.cs(55,23): error CS0542: 'State': member names cannot be the same as their enclosing type
```

**Observed vs expected.** The .NET emitter nests a rehydration holder
`public sealed class State { … }` inside every aggregate class. A field named
`state` produces `public string State { get; private set; }` on the same class.
Collision.

**`state` is documented as a legal field name.** `docs/language.md` §Keywords
lists `state` among the soft keywords and demonstrates it in a code block:
```ddd
aggregate Order {
  state: string        // page-DSL `state {}` keyword — soft as a field
  …
}
```
So the reference tells you to expect this to work, the parser accepts it, and
one of the five advertised backends cannot compile it.

**Found how.** Not by fuzzing — Commons has `aggregate Media { … state: MediaState … }`
because "state" is the natural name for a media-scanning lifecycle. It broke
the .NET build of the real model.

**Workaround.** Rename the field (`status`, `scanState`). Cheap once known;
invisible until you compile that backend.

**Adoption impact.** Same class as F-001: a backend-specific emission bug that
`parse` and `generate` are blind to. Combined with F-001 it means the .NET
target needs a real compile in CI on every model change — which is exactly the
loop the "one source of truth" pitch is meant to remove.

**Time lost:** 20 min.

---

## F-016 · S1 · SILENT — a reference collection (`X id[]`) emits uncompilable Angular

**Claim under test.** README: six frontends, "The page DSL is identical; only
the rendering changes." `docs/language.md` documents `X id[]` as a first-class
many-to-many with no per-frontend caveat.

**Repro.** `/tmp/ng_tags.ddd` (18 lines) — one aggregate with one `Tag id[]`
field and a scaffolded Angular UI:
```
$ node bin/cli.js generate system … -> Wrote 90 file(s), 0 errors
$ docker compose build web
✘ [ERROR] TS2322: Type '{ title: string; tags: null; }' is not assignable to type 'UpdatePostRequest'.
✘ [ERROR] TS2345: Argument of type '{ title: string; tags: null; }' is not assignable to parameter of type 'CreatePostRequest'.
```
The emitter writes `tags: new FormControl(null, { nonNullable: true })` against
a wire type of `tags: string[]`.

**Isolated by experiment** (each built in Docker with the real Angular CLI):

| Field | Angular build |
|---|---|
| `grp: Grp id?` (optional reference) alone | **Built** |
| `tags: Tag id[]` (reference collection) alone | **fails** |

So it is the reference collection specifically.

**Cross-target contrast, same model.** React, Vue and Svelte all build
(`svelte-check found 0 errors and 0 warnings`). Angular does not.

**Adoption impact.** Commons uses `media: Media id[]` on `Post` — an entirely
ordinary shape (tags, attachments, participants). Angular is unusable on any
model that has one. Weigh the "six frontends" claim accordingly: the count is
real at the generate step and thins at the compile step.

**Time lost:** 25 min.

---

## F-017 · S3 · SILENT — `ddd verify` exits 0 when nothing is verified

**Claim under test.** README: "`requirement` → `solution` → `testCase` →
`test` → `ddd verify` → per-requirement Definition-of-Done verdicts. No
separate Jira/CI/git triangulation."

**Repro.** `/tmp/trace.ddd` declares 2 requirements, 1 testCase, 1 test.
```
$ printf '{"version":1,"results":[]}' > /tmp/empty.json
$ node bin/cli.js verify /tmp/trace.ddd --results /tmp/empty.json ; echo "exit=$?"
Verified 0/2 requirements (0 failing, 2 unverified, 0 untested).
exit=0
```
Zero requirements verified, gate green. Documented (exit 1 only on `FAILING`),
and `--require-all` / `--min <pct>` are provided — but the *default* is the
unsafe one, and the most likely CI breakage produces it.

**Amplifier: the join is a hand-built stringly-typed key.** `ddd verify` does
not consume the runner output its own generated tests produce. Feeding vitest's
`--reporter=json` directly:
```
Could not parse results file: expected a top-level "results" array
```
You must write an adapter (documented: "You produce this from your runner's
report"). The join is `(suite, name)` where `suite` must be "the **aggregate
name** for a unit test, `"<System> e2e"` for an api/ui e2e test". My first
adapter used the test *filename* as `suite` — result: `0/2 verified`, exit 0,
with the test listed as `(missing)`. Correcting `suite` to `Post`:
`Verified 2/2 requirements`, exit 0.

So a convention mismatch and full success are the same exit code, and renaming
a test in the `.ddd` silently unlinks it from its requirement — the verdict
degrades `VERIFIED → UNVERIFIED`, which is not a failure.

**Adoption impact.** The feature works and the `verification.md` artifact is
good. But wired naively it is a gate that cannot fail. If you adopt it, run
`ddd verify --require-all` (or `--min`), and add a check that
`diagnostics.unknownTests` is empty — otherwise the quality story reports
success precisely when the link between tests and requirements has broken.

**Time lost:** 30 min.

---

## F-018 · S3 · DOCUMENTED — `ddd trace` cannot map the default backend's shipped bundle

**Repro.** Generate with `--sourcemap`, then feed a stack trace from the
running node backend (whose image runs `dist/index.js`):
```
ddd trace: no frame matched the sourcemap (0 of 2 stack frame(s)).
  frame files: /app/dist/index.js
  A BUNDLED frame (dist/…, *.min.js, a single-file build) names the bundle,
  not the generated file the map is keyed by. Run the process from the
  generated sources, or resolve the bundle's own source map first …
```
The generated node project builds with `tsup` into `dist/index.js`, so the
production artifact Loom itself emits is exactly the shape `ddd trace` cannot
map without an extra step.

The diagnostic is **excellent** — it names the cause and three remedies — which
is why this is S3 and DOCUMENTED-at-the-point-of-failure rather than silent.

`ddd breakpoints` works but with uneven precision: of four `.ddd` lines probed,
one resolved to `api/domain/media.ts:50:19` (column-accurate), two to
`<file>:1` (file-level only), one to nothing.

**Adoption impact.** Budget for `node --enable-source-maps` plus a bundle
source-map resolution step before `ddd trace` is useful on the default backend;
don't assume 3am debuggability out of the box.

**Time lost:** 15 min.

---

## F-019 · S2 · reconciliation — the maintainers' internal audit contradicts the README's unqualified cross-target claims

*(Recorded after Phase 6, when internal material was opened for the first time.)*

**Claim under test.** README: "Five backends from one source … **Identical API
contracts**; idiomatic per-runtime output"; "**No drift between layers**";
Status: "CI matrix generates every example against every design pack … the
backends are compiled against real toolchains". No caveat anywhere on the page.

**What the maintainers' own material says.**
`docs/audits/targets-completeness-2026-08-30.md` — a snapshot audit produced by
"16 Opus agents, ~4M tokens, 2100+ tool calls" against `main` two weeks before
this evaluation, re-verified 2026-09-03:

> **The headline is `partial`.** Eleven of twenty-six rows had a fix land on one
> or two targets and were being read as closed. … Each row now carries a
> `verified.remainingTargets` list, because **"fixed" and "fixed everywhere"
> have been the same word in this ledger and they are not the same thing.**

> `M-T5.14` threads its port on node and **emits a non-compiling call on the
> other four.**

The companion ledger (`…ledger.json`) counts **135 open rows** — P1 ×1, P2 ×11,
P3 ×34, P4 ×80, P5 ×9 — classified by kind as `mission` 58, **`honest` 34**,
`breadth` 22, **`silent` 12**, `stale-prose` 9. The maintainers use the same
silent/honest taxonomy this evaluation uses, and separately track nine rows they
know are **stale prose** in their own docs.

Named open `silent` rows include `dapper-no-schema-evolution` ("every
post-first-boot model change is silently unapplied"), `F2-W-06` (elixir persists
`datetime` at second precision where the other four use microsecond TIMESTAMPTZ),
and `queryview-lambda-int-plus-literal-concat` ("silently wrong on the four JS
frontends").

**Why this is a finding and not just transparency.** The engineering culture
here is genuinely strong — adversarial re-verification, refusing to treat a
merged PR as evidence, a register whose header demands gaps "DRAIN TO ZERO".
The problem is the *distance* between that and the user-facing page. A buyer
reads "Identical API contracts" and "No drift between layers"; the team's own
current assessment is "partial, 135 open, 12 silent". Nothing on the README,
and nothing in `docs/generators.md`'s matrix, carries that qualifier.

**Second-order finding: the audit's blind spot.** None of the six SILENT
defects I found (F-001, F-003, F-005, F-014, F-015, F-016) appear anywhere in
that ledger — not in `open`, `done`, or `checkedOk` (searched for
`MoneyResponse`/`MoneySchema`, `CS0102`/`CS0542`/"enclosing type",
`construction-missing-field`, `FormControl(null`, e2e-vs-route). A 16-agent
fleet spent ~4M tokens on cross-target parity of *known features* and did not
cover "what happens when a user writes an ordinary model" — a shared value
object, a field named `state`, a `Tag id[]`, a VO named `Money`. That is a
statement about the **shape** of their QA, and it predicts where the next
defects will be: not in the features they track, but at the ordinary edges.

**Related internal inconsistency (F-005's root).** Their own wave plan specifies
the correct contract: `test/generator/_frontend/gate-expr.test.ts` asserts
"`tryRenderGate` returns `null`, **never a broken string**, for every
unsupported kind". Both functions exist in `src/generator/_frontend/gate-expr.ts`
— the null-returning `tryRenderGate` (used by the elixir paths) and the
throwing `renderGateExpr` (used by `react/walker/page-shell.ts` and
`svelte/walker/page-shell.ts`). The safe pattern was designed and tested; the
JSX page-gate call sites don't use it.

**Adoption impact.** Do not take the README as the specification. Take
`docs/audits/` + `src/diagnostics/unsupported-register.ts` as the real status
document, and re-read them at each upgrade. If Loom is adopted, make "what
changed in the open ledger" part of the upgrade checklist.

---

## F-020 · S1 · SILENT — `mask unless` emits Java that is missing its `import java.util.Objects`

*(Found in a second pass, after the user pointed me at the toolchain playbook in
`docs/tools.md` that unblocks the Java/Elixir/Flutter/Feliz builds my first pass
marked "unverified".)*

**Claim under test.** `mask unless` is the field-level read-redaction control in
`docs/auth.md`, and the strongest verified result of the first pass — on node it
compiles to a real `toWireMasked(root, currentUser)` that I confirmed against a
live server with two principals.

**Repro.** `eval/repro/F020-java-mask-missing-import.ddd` (12 lines):
```ddd
aggregate Person with crudish {
  name: string
  ssn: string mask unless currentUser.role == "admin"
  derived display: string = name
}
deployable apiJava { platform: java, … auth: required }
```
```
$ node bin/cli.js parse    …  -> 0 error(s), 0 warning(s).
$ node bin/cli.js generate …  -> Wrote 66 file(s)
$ grep -n '^import' …/features/people/PersonResponse.java
3:import com.loom.apijava.auth.CurrentUserAccessor;
4:import com.loom.apijava.auth.User;
5:import java.util.UUID;
7:import com.loom.apijava.domain.enums.*;
8:import com.loom.apijava.domain.ids.*;
9:import com.loom.apijava.domain.valueobjects.*;
$ grep -c 'Objects\.' …/PersonResponse.java
1
```
The mapper calls `Objects.equals(__maskUser.role(), "admin")` and never imports
`java.util.Objects`. Confirmed with the real compiler on the Commons model:
```
…/features/members/MemberResponse.java:21: error: cannot find symbol
  symbol:   variable Objects
  location: class MemberResponse
```

**Why it matters more than an average missing import.** It is the *security*
feature that fails, and it fails closed only by accident — the file does not
compile, so the service does not start. But it means `mask unless`, which I
graded as the evaluation's best verified result on node, has never been compiled
on Java. That is a one-line fix and a missing test, on a feature whose whole
point is that it is enforced in generated code on every backend.

**Adoption impact.** Reinforces C4: a compile gate per target is not optional.

**Time lost:** 15 min.

---

## F-021 · S1 · SILENT — the `for x in Repo.run(Criterion(...))` reactor emits non-compiling Java (and non-compiling F#), the same construct that crashes Elixir

**Claim under test.** `docs/workflow.md` documents
`for x in Repo.run(<Retrieval>(args)) { … }` as workflow body vocabulary, with
no per-backend caveat. It is the natural spelling for a fan-out.

**Repro.** The Commons notification fan-out (`eval/commons/breadth.ddd`), built
with the documented Java recipe from `docs/tools.md`:
```
docker run --rm --network host -v $PWD/api_java:/src -w /src \
  -v /root/.ccr:/root/.ccr:ro -e JAVA_TOOL_OPTIONS="$JAVA_TOOL_OPTIONS" \
  gradle:9-jdk25 gradle --no-daemon testClasses bootJar
```
```java
// application/workflows/CommunityDispatcher.java:40
for (var f : Follows.run(Objects.equals(state.followee(), e.author()))) {
             ^ symbol: variable Follows
                          ^ symbol: method followee()  location: variable state of type FanOutPostState
    notificationsRepository.save(n);
    ^ symbol: variable notificationsRepository
```
Three separate defects in two emitted lines:
1. the repository (`Follows`) is never declared or injected;
2. the criterion `FollowersOf(who)` is **inlined as a boolean argument to
   `run(...)`** — `Repo.run(Criterion(args))` is lowered to
   `Repo.run(<the criterion's predicate>)`, which is not a signature that
   exists — and its parameter `who` is resolved against the *workflow state
   record* (`state.followee()`), which has no such accessor;
3. `notificationsRepository` is never declared.

**The same construct, three targets, three different failures:**

| Target | Result on the identical `.ddd` |
|---|---|
| node, python | generates and compiles |
| **elixir** | **generator crash** — `Error: dispatch-emit: unsupported reactor statement kind 'for-each'` (**F-013**) |
| **java** | **non-compiling output**, above |
| **feliz** | **non-compiling F#** — `error FSHARP: The type 'Model' does not define the field … 'AllFanOutPosts'`, plus `Unexpected keyword 'member' in expression` |

**Corroborated by the maintainers' own material** (Phase 6):
`docs/new-plan/testing-quality-improvement-plan.md:73` describes the shared
`WorkflowStmtIR` spine that owns "the only `for-each`/`if-let` recursion" as
"shared by the **Hono/.NET/Java/Python** workflow emitters" — but Java, which is
on that list, still emits this. Elixir is not on the list at all.

**Adoption impact.** A single ordinary construct — iterate a query result inside
a reactor — is the difference between "five backends" and "two". If you adopt,
treat the workflow body vocabulary as node/python-only until proven otherwise per
construct.

**Time lost:** 30 min (second pass).

---

## VERIFIED GOOD (second pass) — Elixir and Flutter, with the documented recipes

Recording these because the first pass marked them **unverified** and the
correction matters more than the finding.

- **Elixir compiles clean.** Using `LOOM_HEX_MIRROR`'s mechanism
  (`scripts/hex-mirror.py`, documented in `docs/tools.md` § "Elixir builds
  behind a fingerprinting proxy" — a loopback TLS mirror that re-originates
  hex.pm with an accepted fingerprint), `mix deps.get && MIX_ENV=prod mix
  compile --warnings-as-errors` on the **full Commons domain** (10 aggregates,
  auth, channels, moderation, masking — minus only the F-013 workflow) exits
  **0**. That is a real pass on a real toolchain, with warnings as errors.
- **Flutter analyzes clean.** `flutter pub get && flutter analyze` in
  `ghcr.io/cirruslabs/flutter:stable` on the generated Commons app:
  **0 errors, 0 warnings**, 153 `info`-level lints (`prefer_const_constructors`,
  `prefer_interpolation_to_compose_strings`, `no_leading_underscores_for_local_identifiers`).
  `flutter analyze` exits 1 on any issue, so a CI job running it as-is fails on
  style — worth knowing, but the generated Dart is type-correct.

**Method note against myself.** My first pass recorded java/elixir/feliz/flutter
as "unverified — environment", when `docs/tools.md` §§472–700 and §§912–990
document a working recipe for each of the four, *by name*, including two
sections titled for exactly the fingerprinting-proxy failure I hit. Two of the
four then passed and two failed with real, new S1 defects. **An "unverified"
row is not a neutral row** — it hid two passes and two failures, and I should
have searched the docs for a recipe before recording it.

---

## F-022 · S1 · SILENT — a field named `member` (a reserved F# keyword) emits syntactically invalid F#

**Claim under test.** README: six frontends, "The page DSL is identical; only
the rendering changes." Feliz is one of the six.

**Repro.** `eval/repro/F022-feliz-fsharp-keyword-field.ddd` (20 lines):
```ddd
aggregate Note with crudish {
  member: Person id          // legal in Loom; reserved in F#
  body: string
  derived display: string = body
}
deployable web { platform: feliz, targets: api, ui: W, port: 3005 }
```
```
$ node bin/cli.js parse    …  -> 0 error(s), 0 warning(s).
$ node bin/cli.js generate …  -> Wrote 62 file(s)
$ dotnet fable + vite build (mcr.microsoft.com/dotnet/sdk:8.0)
./src/App.fs(128,5): error FSHARP: Unexpected keyword 'member' in field declaration.
                                   Expected identifier or other token. (code 10)
./src/App.fs(128,5): error FSHARP: This field requires a name (code 882)
./src/App.fs(158,7): error FSHARP: Unmatched '{' (code 604)
```
The emitter writes `member: string` straight into an F# record. `member` is how
F# declares a member — the record literal does not parse, and the damage
cascades (`Unmatched '{'`) through the rest of the file.

**Isolated, and it is the *only* Feliz blocker.** On the full Commons model with
the fan-out workflow removed, Feliz failed with these same syntax errors.
Renaming that one field `member` → `recipient` and rebuilding:
```
✓ built in 4.40s
dist/assets/index-DLGK3NAu.js   894.43 kB │ gzip: 118.45 kB
EXIT=0
```
**Feliz builds the entire Commons UI** — 10 aggregates of scaffolded pages, auth
gates, forms — into a real bundle. The frontend is genuinely functional; the
emitter simply has no reserved-word map.

**This is the same defect class as F-015** (`state` on .NET) and the same root
as F-001: **a model identifier interpolated into target syntax with no escaping
and no gate.** Loom's own keyword discipline is careful — `docs/language.md`
devotes a section to hard vs soft keywords *in the DSL* — but nothing maps a
legal Loom identifier onto each target language's reserved set.

**Workaround.** Avoid target-language keywords in field names. There are five
target languages, so the union is large and undocumented: `member`, `state`,
`type`, `class`, `object`, `end`, `when`, `val`, `def`, `lambda`, …

**Adoption impact.** Unlike F-016 (angular / `X id[]`), this needs no emitter
redesign — a per-target reserved-word escape map is a contained fix. But until
it exists, naming a field is a cross-language minefield that `parse` will not
warn you about, and the failure surfaces only in whichever target you compile.

**Time lost:** 25 min (second pass).
