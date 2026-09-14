# Wave C2 packet 2d — java / Spring / JPA — `claude/c2-java`

Base: the wave C2 coordinator commit `29db198c1` (fast-forward from `main` @ `6d6c1a1`).
Commit range: `29db198c1..HEAD` (12 commits). Branch **not pushed**; the wave PR is the claim.

Tree fence: `src/generator/java/**` plus the tests, the corpus fixtures, the
diagnostic catalogue / register rows, the Schemathesis waivers and the docs a
closed row requires. Two hunks land outside it; both are named below under
"Cross-fence hunks", both are the deletion the row itself names.

---

## Rows

| row | outcome | where |
|---|---|---|
| **M-T6.36** reserved identifiers | **implemented** — gate deleted, `MAX_OPEN_GAPS` 27 → 26 | `src/generator/java/java-ident.ts` (new funnel) + 22 emitters; `test/generator/java/java-reserved-identifier.test.ts:1`; `test/fixtures/corpus/java-reserved-words.ddd:1`; `test/system/unsupported-register.test.ts:295` |
| **M-T4.2** java document-shaped aggregation | **implemented** — gate deleted, manifest row back to `ALL` | `src/generator/java/emit/query-projection-reads.ts:125` (`documentTableOf`), `:357` (grouped), `:432` (singleton); `src/generator/java/index.ts:1097`; `test/generator/java/query-projection-document-aggregation.test.ts:1` |
| **`G2667-D3`** java projection-join arm | **already closed** — verified, not rebuilt | `src/generator/java/emit/query-projection-reads.ts:901` (the null-guarded lookup with the wire wrap INSIDE the guard); `test/generator/java/query-projection-join-missing.test.ts` — 5 passed on this head |
| **Schemathesis F11** (W11/W12) | **already closed** — verified, not rebuilt | W11/W12 absent from `test/behavioral/schemathesis-waivers.json`; `test/generator/int32-wire-bound.test.ts` — 9 passed on this head; java has always published `format: int32` and rejected the overflow at the binder |
| **Schemathesis F21** (W27/W34) | **W34 implemented + deleted**; W27 (dotnet) **handed off** | `src/generator/java/emit/common.ts:385`; `test/generator/java/wire-numeric-ingress.test.ts:121`; `docs/audits/schemathesis-findings-2026-08.md:1192` |
| **`render-sql-restriction.ts:32`** principal-`scope` refusal | **proved unreachable, made a floor** | `test/generator/java/sql-restriction-scope-unreachable.test.ts:1` |
| java arms of **`F2-XB-4`** / **`F2-CB-C7`** | **not handed off by C1 1e — both were FIXED there.** Verified on this head, not rebuilt | `test/conformance/projection-fold-statement-parity.test.ts` + `test/generator/domain-service-gate-import-parity.test.ts` — 38 passed together with the join test |

---

## Reserved identifiers (M-T6.36) — what shipped

**The problem in one line:** Java has no verbatim identifier (JLS §3.9), and a Java
record component name IS the Jackson property, the springdoc schema key and the
Spring binding path — so the rename that makes the name compile also moves the
wire, on java alone.

**The shape of the fix** is one funnel whose two halves cannot travel apart
(`src/generator/java/java-ident.ts`):

* `jid(name)` — the HOST identifier (`case` → `case_`).
* `jsonProp(name, imports)` / `requestParam(name)` — the WIRE key pinned back on.

Both are the IDENTITY for a non-keyword name, which is what makes this
byte-identical for every existing model and is why the sweep below is the real
gate rather than a per-site assertion.

**Wire sites covered** (each one would otherwise have taken the java identifier as
its name): request / response / event / value-object / projection-row /
workflow-instance record components; a find's query parameter; the RFC-7807 error
pointer (Spring builds it from the BINDING path and never routes it through
Jackson, so `ApiExceptionAdvice.pointerOf` carries a generated inverse map); the
`?sort=` whitelist (stays the wire key, with one generated translation line to the
JPA property); and the enum COLUMN.

**The enum arm was a second, previously SILENT gap**, found while draining this one:
`enum Kind { case, plain }` parsed with **zero diagnostics** on java and emitted
`public enum Kind { case }` — uncompilable. The gate's `javaIdentifierPositions`
never enumerated enum values. Closed here rather than filed, because leaving it
would have re-created the same silent crash one declaration kind over.
`@Enumerated(STRING)` persists `Enum.name()`, so a mangled constant would have
written `case_` into the column where every other backend writes `case`; the enum
therefore carries a generated `<Enum>.Codec` `AttributeConverter` and
`jpaFieldAnnotations` selects `@Convert` for exactly those enums.

### Reachability, measured

38 of the 53 Java reserved words are reachable as a `.ddd` field name today
(`abstract`, `else`, `enum`, `extends`, `for`, `if`, `import`, `int`, `long`,
`return`, `static`, `this`, `true`, `false`, `null` are parse errors; `private` is
one in field position only). **#2883 is not on `main` and does not widen this set** —
it promotes `of` / `allow` / `deny` / `local` / `deep` / `global` / `policy` /
`persistence`, none of which is a Java keyword. Nothing about that PR was
load-bearing here either way.

### Mutation proofs (file copy, never `git checkout --`)

| mutation | failing assertion |
|---|---|
| drop `jsonProp` from the wireShape response record | `…/TicketResponse.java must carry @JsonProperty("case") String case_` |
| bare `@RequestParam` instead of the named one | `expected … to contain '@RequestParam("case") String case_'` |
| enum column back to `@Enumerated(EnumType.STRING)` | `expected … to contain '@Convert(converter = Kind.Codec.class)'` |
| drop the `?sort=` translation line | `expected … to contain 'case "case" -> "case_";'` |
| unmangled member read in `render-expr.ts` | `bare reserved word read through a receiver: expected [ …(4) ] to deeply equal []` (the sweep) |

### Boot proof — a real Spring Boot app on a real Postgres 18

`gradle:9-jdk25` build of the generated project, `java -jar` against
`postgres:18-alpine`, migrations applied, Hibernate mappings validated:

```
POST /api/tickets   {"case":"alpha","do":7,"final":true,"native":"12.50",
                     "span":{"double":1,"char":"x"},"spans":[…],"owner":…}   201
GET  /api/tickets/{id}  -> {"id":…,"case":"alpha","do":7,"final":true,
                            "native":"12.5000","span":{"double":1,"char":"x"},
                            …,"transient":"alpha"}
GET  /api/tickets?sort=do&dir=desc   -> a page (was 500: "Could not resolve
                                        attribute 'do' … [order by e.do desc]")
GET  /api/tickets/by_case?c=alpha    -> the row  (JPQL `where e.case_ = :case_`)
POST /api/tickets  {"do":-1,…}   -> 422  errors[0].pointer = "/do"     (not "/do_")
POST /api/tickets  (no "case")   -> 422  errors[0].pointer = "/case"   (not "/case_")
```

…and for the enum arm, on its own booted app: the wire accepts and returns
`"case"`, the published `Kind` schema is `{"enum":["case","do","plain"]}`, the
MANGLED spelling `"case_"` is **rejected** (400), and `select kind from c.tickets`
returns `case` — the `.ddd` spelling, in the column.

`?sort=do` is the one that matters most: it 500d **after** the entity and the DTOs
already compiled and booted, because the `?sort=` whitelist fed a JPA property
path. No compile tier could have seen it.

### Corpus + differential

`test/fixtures/corpus/java-reserved-words.ddd` uses names reserved in **Java only**
(`final`, `native`, `synchronized`, `transient`, `throws`, `strictfp`, `boolean`) —
computed against `naming.ts`'s four other keyword sets, and none is a Postgres
reserved word — so the row is `ALL`: the other four backends must keep emitting
them bare, and the SQL-quoting class stays with `reserved-words.ddd`.

The e2e passes on **node** (PGlite, wire golden captured from the oracle) and on
**java** against the booted app: `wire differential (java): 1 case(s) compared to
golden, 0 divergence(s)`. Re-run after the F21 change — still 0.

---

## Document-shaped aggregation on java (M-T4.2)

Java's direct-table aggregation ran JPQL through the `EntityManager`
(`select count(e) from Article e`) against an aggregate with **no JPA `@Entity`** —
a document aggregate round-trips one jsonb column through a `JdbcTemplate`
repository — so Hibernate failed with "could not resolve root entity" at REQUEST
time.

The fix is the same query, run **native**. `columnlessProjectionSource` already
guarantees `id` is the only member a direct-table arm over such a source may name,
and `e.id` reads identically in JPQL and in SQL, so the `where` renderer and the
grouping-key renderer are shared verbatim. Only two things move: the entity name
becomes the schema-qualified TABLE and `count(e)` becomes `count(*)`. Binding
(`setParameter`) and the promoted-capability bypass wrap are the same code on both
paths. **Both** direct-table arms are covered.

Boot proof (a compile tier cannot see a wrong number):

```
GET /api/projections/article_volume  -> {"articles":0}
POST /api/articles x3
GET /api/projections/article_volume  -> {"articles":3}
GET /api/projections/per_id          -> [{"key":…,"n":1},{"key":…,"n":1}]
```

Mutation-proved twice — `documentTableOf` always `undefined`, and stop rewriting
`count(e)` → `count(*)` — each failing the two `createNativeQuery` assertions.

Deleted with it: `validateDocumentAggregationBackend`,
`PROJECTION_DOCUMENT_AGG_SUPPORTED`, and the two `#document` message variants
(plus their `diagnostic-message-hygiene` pins). The corpus manifest row is back to
`ALL` and `test/ir/projection-document-aggregation.test.ts`'s java arms flip from
negative to positive.

---

## `render-sql-restriction.ts:32` — the refusal is a floor now, not a hope

The static `@SQLRestriction` seam is parameterless, so a principal-referencing
`scope` decision cannot be expressed there and the arm throws. **It is
unreachable**, and the new test pins every LINK rather than only the end-to-end
shape, because a chain proved end-to-end goes quiet the moment one link moves:

1. a `scope` decision carries `currentUser.<anchor>` / `currentUser.tenantId` as
   real child expressions;
2. `walkExprChildren` descends into them for an `authz-filter` node;
3. so `exprUsesCurrentUser` answers true;
4. and BOTH callers — `sqlRestrictionFilters` and `promotedFilters`, which calls
   the same renderer and is the arm a reader forgets — drop it first.

Link 2 is one `if` inside one `case` of the shared walker. Mutation-proved by
exactly that deletion: **3 of 4 cases fail**, ending in the real crash
(`Error: @SQLRestriction renderer: principal-referencing 'scope' filter … is
outside the static-filter subset`). `walk.ts` was restored by file copy.

**No `loom.*` code was minted**, so nothing was added to `messages.ts`,
`code-docs.ts` or the firing census.

---

## F21 / W34 — the rule text was wrong; the real defect is a coercion

W34's reason was a guess the previous round's own measurements had disproved, with
"re-triage against a nightly" recorded as the next step. Ran the leg instead
(booted java `sales-system`, `LOOM_SCHEMATHESIS_BASE`) and read the ndjson report:

```
POST /api/customers  {"name":"","email":false}  -> 201
POST /api/customers  {"name":"","email":0}      -> 201
  scenario: incorrect_type — "email: Incorrect type" at /properties/email/type
```

Jackson's default coercion turns a JSON number or boolean into a String, so a body
the API's own published schema declares `type: string` was accepted and a row was
created with an email nobody sent. **Java alone, measured from outside both
emitters:** the same fuzzer, fixture and check on the **node** leg report nothing
on that route.

Blast radius is every string-typed wire field, which on java includes `money` (it
rides the wire as a decimal string), so `{"price": 12.5}` was accepted too — the
cell `numeric-ingress-parity`'s header table records java as REFUSING. The fix
makes that matrix **true** rather than moving it.

Fix: `WireNumberStrictness` already failed String → Integer (M-T6.48); it now also
fails Integer / Float / Boolean → `LogicalType.Textual`. Before/after on the booted
app: `{"email":0}` 201 → 400, `{"email":false}` 201 → 400, `{"name":7}` 201 → 400,
a real string still 201. Both java cases then fuzz clean with **no new findings**,
so the narrowing rejects nothing the fixtures rely on. W34 goes stale (the ratchet
says so, loudly) and is deleted in the same commit.

---

## Cross-fence hunks (name them at fold)

| row | file | why |
|---|---|---|
| M-T6.36 | `src/ir/validate/checks/backend-syntax-checks.ts`, `src/ir/validate/validate.ts`, `src/ir/validate/checks/system-checks.ts`, `src/util/naming.ts` | the gate deletion the row names. `naming.ts` keeps `isJavaKeyword` (now the predicate behind `isMangled`); only its doc comment changed |
| M-T4.2 | `src/ir/validate/checks/projection-backend-checks.ts`, `src/ir/validate/validate.ts`, `src/ir/validate/checks/system-checks.ts` | the `PROJECTION_DOCUMENT_AGG_SUPPORTED` deletion the row names verbatim |

Both live in **packet 2f's** tree (`src/ir/**`). 2f is batch 2 and runs after this
one, so the fold order is right; the hunks are deletions only, no behaviour added.

Also re-pointed four `site:` line numbers in `unsupported-register.ts` that drifted
when code was deleted from `projection-backend-checks.ts` (the register's own
"site resolves to its code" gate caught it).

---

## Open-PR overlaps on this fence

| PR | files | overlap |
|---|---|---|
| **#2852** | `repository.ts` | **YES, same file.** Mine: `jid` on find names / `@Param` / params, and the `?sort=` → property translation (`sortPropertyLines` / `sortPropertyVar`, added at the end of the file). Independent of `envelope` |
| **#2886** | `openapi-customizer.ts`, `wire.ts`, `workflow.ts` | **`workflow.ts` only**, one line (`request.${jid(f.name)}()` in the workflow request mapper). `openapi-customizer.ts` and `wire.ts` untouched — springdoc derives the schema key from Jackson, so nothing had to change there |
| **#2901** | `service.ts` | **YES, same file.** Mine is `jid` at the local-binding / accessor / op-call sites; the nested-VO work is elsewhere in the file |
| **#2903** | `channels.ts`, `query-projection-reads.ts`, `numeric-codec.ts` | **`channels.ts`** one line (the CloudEvents payload map read) and **`query-projection-reads.ts`** (M-T4.2 lives here). `numeric-codec.ts` untouched — the F21 fix is in `common.ts` |
| **#2900** | `auth.ts` | one line (the `currentUser` claim body read) |
| **#2883** | grammar reserved words | **no overlap** — still open, not on `main`, and none of its eight words is a Java keyword |

No row was skipped as already covered by an open PR.

---

## Handed off

1. **W27 (dotnet), F21's other half** — same route, same check, still un-diagnosed.
   The java cause does **not** transfer (System.Text.Json refuses Number→String by
   default). The method is now written down in the audit and is cheap: boot the
   generated .NET app, run the leg with `LOOM_SCHEMATHESIS_BASE`, read the failing
   case out of the ndjson report. **Packet 2b.**
2. **`src/macros/stdlib/scaffold/scaffoldDashboard.macro.ts:78`** — a comment that
   still names `loom.projection-whole-table-aggregation-unsupported#document` as a
   reason the macro skips a document-shaped aggregate. The BEHAVIOUR is unchanged
   and target-neutral (`hasDashboardTable` skips such an aggregate on every
   backend, because only `id` is nameable); only the java clause of the comment is
   now stale. One-line doc fix, `src/macros/**`, outside this fence.
3. **`src/generator/java/emit/projection-state.ts`** — the defect C1 packet 1e
   filed here ("a projection row's non-key columns are rendered with
   `renderJavaType(f.type)` on a `{...f, optional: true}` FieldIR — the OPTIONAL
   flag moves, the TYPE does not") is **still present** on this head. Not this
   packet's row and not touched; re-filed so it is not re-discovered a third time.
4. **`src/generator/java/render-stmt.ts`'s `add`/`remove` leaves** — 1e's second
   note (no branch on `s.collection`, so a scalar `n += v` would emit
   `this.total.add(…)`). Still unbranched; still not shown reachable. Unchanged.

## Decisions needed from the owner

**None.** No row needed a ruling; no row was re-classed as `scope`, and no `D-*`
entry was added.

One thing worth an owner's eye at fold: the F21 fix moves java's answer to
`{"price": 12.5}` on a `money` field from **accept** to **400**. That is the value
`test/conformance/numeric-ingress-parity.test.ts`'s header table already claims for
java (M-T6.60 divergence 2 lists java among the four that refuse), so the change
makes the documented matrix true — but the mission's stated REASON for that cell
("the request field is typed as a string, so the value never reaches a guard") was
wrong: the string typing is exactly what Jackson coerced into. M-T6.60's prose is
left alone here because divergence 2 is `blocked(D-NUMERIC-INGRESS-STRICT)` and
correcting it is that decision's business, not this packet's.

---

## Local gates (run on this tree, after the last commit)

| command | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | ratchet OK — 181 files, 469 errors, `src/` clean |
| `npm run lint` (`biome ci .`) | rc 0 |
| `node scripts/mission-counts.mjs --check` | OK (M-T6.36 archived to `archive/T6-done.md`) |
| `node scripts/ledger-counts.mjs --check` | OK |
| `node docs/build.mjs` | clean |
| `npm test` | **2011 files / 23416 tests passed**, 0 failed (7 expected-fail, 1082 skipped) — see the two subsections below |
| `npx vitest run test/generator/java` | 604 passed (100 files) |
| corpus java compile, `java-reserved-words` | `gradle --no-daemon -q testClasses bootJar` clean |
| corpus java compile, `projection-document-aggregation` | clean |
| behavioural java leg, `java-reserved-words` | 1 passed, wire golden 0 divergences |
| behavioural node leg, `java-reserved-words` | 1 passed (golden captured from the oracle) |
| schemathesis java, `sales-system` + `storefront-system` | clean, no new findings |
| schemathesis node, `sales-system` | clean (the cross-backend control for W34) |

**The corpus java compile tier was run by hand, not through
`npm run test:java-corpus`:** that vitest leg needs JDK 25 + Gradle 9.1+ on the
host PATH and the sandbox ships JDK 21 + Gradle 8.14, so both fixtures were built
in `gradle:9-jdk25` — the image the emitted Dockerfile names — with
`--network host` and the session's `JAVA_TOOL_OPTIONS`. Same command, same
toolchain, different launcher.

### What the full `npm test` caught that no targeted run did

Four ratchets, all of which only bite from the WHOLE run, all fixed in-tree:

* `direct-generate-systems-ratchet` — `java-reserved-identifier.test.ts` had
  inherited `parseHelper` + `generateSystems` from the sibling file it sat beside,
  which bypasses phases ①/④/⑦. Moved onto `generateSystemFiles`; the test is
  shorter for it and nothing was added to `PINNED`.
* `diagnostic-docs-anchors` `UNDOCUMENTED_BASELINE` 369 → 368 — deleting a code
  shrinks the undocumented list, and that ratchet only ratchets if the number
  comes down with it.
* `unsupported-register` "resolves every cited mission to exactly one heading" —
  this note's own `## M-T4.2 — …` heading made the id ambiguous under
  `docs/new-plan/`. The note's headings now carry the id in parentheses.
* `api-caller-census` — `crudish` derives an `update` route and the new corpus
  fixture never called it, leaving the whole FULL-REPLACEMENT path untested for
  every reserved-word component while `create` proved only the factory. A pin
  would have recorded that as deliberate; it was not, so the e2e drives `update`
  (and the later reads moved to observe the replaced row). Golden re-captured
  from node, 11 → 13 requests, and re-verified on the booted java app.

### One environmental failure, NOT a defect

`packaging-split-fs-discovery` / `packaging-split-core-pkg` (4 tests) fail in a
bare **worktree**: `discoverBackendsFs(repoRoot)` reads the literal
`<repoRoot>/node_modules`, and a worktree has none of its own — Node resolves
up to the main checkout, that walk does not. Confirmed by symlinking
`node_modules/@loom` from the main checkout into the worktree, after which all
four pass; nothing in this packet's diff touches `packages/`, `fs-discovery.ts`,
`registry.ts` or any `package.json`. Worth knowing for every worktree-based
packet in this wave.

Neither this nor the docker wrinkle below is in `experience_gathered.md`, and
both cost real time here; that file is outside this packet's fence, so they are
recorded here for whoever harvests the wave.

**Docker, for whoever repeats this:** `dockerd` needed starting, the registry was
reachable, but port 5432 (and 55432) were already bound by other agents' sidecars,
so the Postgres here runs on **15987** and container-to-container work goes through
a user-defined network (`docker inspect` reports no IP for a bridge container in
this sandbox, so a published port is not reliable). The disk is shared and was at
100% twice; `docker builder prune` and deleting my own generated trees cleared it.
