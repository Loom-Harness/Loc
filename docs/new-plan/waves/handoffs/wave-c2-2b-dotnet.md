# Wave C2 · packet 2b — .NET / EF / Dapper

**Branch** `claude/c2-dotnet` (local; never pushed, never a PR — the wave PR is
the claim and the coordinator folds this branch).
**Range** `29db198c1..HEAD` — five code/disposition commits, a merge of
`origin/main` @ `9a8f2fe00` (`7e6cdabde`) so every gate below ran on the FOLDED
tree (§3 rule 14), and three tail commits (this note, the two doc indexes the new
leg has to appear in, and one visibility-only tidy).
**Fence** `src/generator/dotnet/**` plus the tests, corpus fixtures, register /
message-catalog rows, docs and ledger a closed row requires. Every edit outside
that is listed in §5 with its reason.

---

## 1. Rows → outcome

| row | outcome |
|---|---|
| `loom.dapper-unsupported#deep-scope` | **built** — hierarchical tenancy renders on Dapper (`src/generator/dotnet/emit/dapper.ts:864`) |
| `DAPPER_UNSUPPORTED` `tenancy-hierarchy` | **drained to `{}`**, with its `allowlist-ratchet` pin 1 → 0 |
| `loom.find-predicate-unsupported` on dapper | **already drained** before the packet; the register row's claim corrected |
| `loom.dapper-unsupported#migrations` | **dispositioned** — owner minted (M-T2.17); the build is out of fence |
| `loom.dapper-unsupported#schema-split` / `#schema-ignored` | **dispositioned** — folded into M-T2.17 slice (d) with a recommendation |
| `dapper-no-schema-evolution` (ledger) | **owned, still open** — D-DAPPER-ALTER's ruling already existed; it needed a mission, not a decision |
| `loom.tph-filter-unsupported` | **re-classed `gap` → `scope`** under a new `D-TPH-SUBTYPE-FILTER`, owner M-T6.72 |
| M-T5.7 `<Concrete>Id` threading | **built** — the row as written was already done; its unnamed residue was not, and is |
| M-T6.14 EF `HasColumnName` correlation | **built** — the emission was already done; the gate that could see it was not, and is |
| pairwise F12 dotnet | **drained** — the waiver was stale; measured, then narrowed to python |
| `G2646-open-projection-on-event-no-channel` dotnet arm | **HAND-OFF** — the dotnet arm is a no-op; the whole change is one line in 2f's fence (measured, §5) |

`MAX_OPEN_GAPS` 27 → **26**.  `node scripts/completion-denominators.mjs` on the
folded tree: register **26** `gap` + 24 `seam` + **12** `scope` (was 27/24/11);
targets ledger open **134** (was 135); pairwise compile waivers **4** (was 5, and
zero of them name dotnet); live missions **160** (was 158 — M-T2.17 and M-T6.72
minted).

---

## 2. What was built

### 2.1 Hierarchical tenancy on the Dapper adapter (`a8ae9e155`)

The refusal said the `deep`/`global` materialized-path sentinel's
`currentUser.<claim>` sub-expressions "cannot reach `collectFilterPrincipalRefs`".
They cannot — because the sentinel HAS no such sub-expression: the anchor and
tenant claims are derived from the `scope` decision, so a structural walk can
never see them however deep it goes. Three changes:

- `authzFilterToSql`'s `scope` arm renders the descendant-or-self fragment as raw
  Postgres, structurally the MikroORM `raw()` twin — unqualified columns, the
  anchored `strpos(col, anchor || '.') = 1` RECHECK that decides the row, the
  sargable `LIKE … ESCAPE '!'` prefilter beside it, and the NULL-`data_key`
  fallback to the flat tenant floor.
- `collectFilterPrincipalRefs` moves off its hand-rolled four-kind recursion onto
  `walkExprDeep` and contributes the sentinel's four bindings BY KIND. Its
  `ir-walk-census` waiver (`dapper.ts#walk`, `TRAVERSAL_TIME_BOXED`) is deleted in
  the same commit.
- `FilterPrincipalRef` gains an optional value expression, so the escaped LIKE
  pattern and the anchored needle bind through `_expr/subtree-like.ts` — the one
  escaping chain all six backends already spell.

**A second defect, found only by booting.** The registry self-scope comparison
rendered `id = @__cu_tenantId` — `uuid = text` — so every read of the registry
answered `42883: operator does not exist`. A 500 on a project that builds clean
under `/warnaserror`, because the predicate is a string. The claim now binds as a
separate uuid-typed parameter parsed fail-closed through a `__ClaimGuid` helper
(the raw-SQL twin of EF's `Guid.TryParse(…) ? new <Agg>Id(g) : null` hoist —
`guidFromStringSelfScope`, M-T3.7(c)), and the text parameter it replaces is no
longer bound at all (binding a parameter the SQL does not name is F2-ADP-9 in the
other direction).

### 2.2 M-T5.7 — the identity type that LEAVES a TPH hierarchy (`9f157f876`)

The mission's "~49 application-layer sites" were already threaded: generating
`tph.ddd` leaves exactly two `CustomerId` occurrences in 71 files, both the id
class's own declaration. The residue it did not name is a cross-aggregate
`customer: Customer id`. Each emitter renders a referenced id as
`${targetName}Id` from the IR's own `targetName`, independently, in ~20 places,
so the field / event record / commands / EF converter said `CustomerId` while
`ICustomerRepository.GetByIdAsync` said `PartyId`. The two only MEET where
generated code passes one to the other — a reactor's
`Customers.getById(e.customer)` — which was `CS1503` with `ddd parse` reporting
zero errors.

Fixed at the root: a TPH concrete's `Domain/Ids/<Concrete>Id.cs` is a
`global using` ALIAS for `<Root>Id`. That states what a shared table already
means, makes all twenty spellings one CLR type by construction, and threads no
aggregate pool into twenty call sites.

### 2.3 M-T6.14 — the state-table column correlation (`635908594`)

The `HasColumnName` emission was already right on both emitters. The only pin was
a spot `toContain` for a literal the emitter itself writes — consistency, not
correctness (§3 rule 12), and silent about any column the config forgets. The new
gate sweeps every `*(State|Row)Configuration.cs` in the emitted tree and asserts
its `HasColumnName` set EQUALS the column list parsed out of the emitted
migration DDL: an expected value produced by the other half of the contract
(phase ⑨ `MigrationsIR` → `sql-pg.ts`), through a different renderer, from a
different input.

---

## 3. Proofs

### Mutation proofs (assertion named, per §3 rule 6/13)

Every mutation was reverted with a file COPY, never `git checkout --`
(CLAUDE.md; §84).

| what was mutated | assertion that failed |
|---|---|
| dapper `scope` arm: drop the anchored recheck | `expected '        var r = await conn.QuerySingl…' to contain 'strpos(data_key, @__cu_orgPath__needl…'` |
| dapper: stop contributing the derived bindings | `expected '// Auto-generated.  Dapper persistenc…' to contain '__cu_orgPath__like = RequestContext.C…'` |
| dapper paged find: filter the PAGE query but not the COUNT | `a read over accounts with no subtree predicate: var total = await conn.ExecuteScalarAsync<int>(new CommandDefinition("SELECT COUNT(*) FROM accounts"…` |
| dapper `scope` arm: unescaped `LIKE`, no recheck (**booted**) | `expected [ 'orgXa.leak', 'org_a', …(2) ] to deeply equal [ 'org_a', 'org_a.b', 'org_a.b.c' ]` — a real cross-tenant leak |
| dapper: bypass the self-scope uuid arm | `expected '// Auto-generated.  Dapper persistenc…' to contain 'id = @__cu_tenantId__uuid'` |
| saga state: drop the correlation column's `HasColumnName` | `expected [ 'attempts' ] to deeply equal [ 'attempts', 'order_id' ]` |
| projection row: spell columns with the raw camelCase name | `expected [ 'at', 'orderRef', 'status' ] to deeply equal [ 'at', 'order_ref', 'status' ]` |
| TPH concrete id: revert the alias to a distinct struct | `expected '// Auto-generated.\nnamespace Api.Dom…' to contain 'global using CustomerId = Api.Domain.…'`; building that same generation by hand is `DunningOnInvoiceRaisedHandler.cs(37,50): error CS1503: Argument 1: cannot convert from 'D.Domain.Ids.CustomerId' to 'D.Domain.Ids.PartyId'` |

One note for the next agent, because it cost a cycle: the e2e legs shell out to
`node bin/cli.js`, which runs `dist/`. A mutation to a `src/` emitter with **no
`npx tsc -b` after it** produces a GREEN run against the old build — i.e. a
mutation proof that silently proves nothing. Rebuild between mutate and run.

### Boot proof (§3 rule 10 — framework-enforced, so `npm test` cannot see it)

`test/e2e/tenancy-hierarchy-dapper.test.ts` (new leg; npm script
`test:tenancy-hierarchy-dapper`, wired into `tenancy-e2e.yml` as the
`dotnet-dapper / hierarchy` matrix cell) generates the corpus fixture under
`dotnet { persistence: dapper }`, boots it on a real Postgres (docker sidecar)
and runs the shared `assertHierarchyIsolation` — subtree reads, the DELIMITER
trap (`org_ab` vs `org_a`), the WILDCARD trap (`orgXa.leak`, unreachable only if
the pattern escapes the `_` in the caller's own path), by-id 404s in both
directions, and the NULL-`dataKey` degrade-to-floor probe. **Green**, and red
under the mutation above. The .NET SDK is not on this sandbox's PATH by default;
installing it (`dotnet-install.sh --channel 10.0 --install-dir /opt/dotnet`)
lets the leg run exactly as CI does, which is why the committed test is the
unmodified sibling of `tenancy-hierarchy-dotnet.test.ts` rather than a
docker-boot variant.

The `42883` defect in §2.1 was found by this leg on its first run
(`set_path` → 500) and traced from the emitted server log, not from reading code.

### Compile proofs

- `LOOM_DOTNET_BUILD=1 LOOM_CORPUS_DAPPER_CASE=tenancy-hierarchy npm run
  test:dapper-corpus` — 70 passed; the fixture that was EXCLUDED from this leg
  now builds in it.
- `LOOM_DOTNET_BUILD=1 npx vitest run test/e2e/generated-dotnet-build.test.ts -t
  "cross-aggregate"` — the new `tph-crossref.ddd` builds under `/warnaserror`.
- `LOOM_PAIRWISE=1 LOOM_DOTNET_BUILD=1 npm run test:pairwise-corpus-dotnet` —
  **26 passed, zero waivers left for dotnet** (was 21 passed / 5 failed on the
  REVERSE ratchet, which is how F12's staleness was measured rather than assumed;
  the five: `none-document-requires-tph-paged-dapper`,
  `none-eventLog-mask-paged-default`,
  `softDeletable-document-policyAllow-paged-default`,
  `tenantOwned-document-none-tph-paged-dapper`,
  `none-document-deny-tph-paged-dapper`).

### Local gates on the merged tree (after `git merge origin/main`)

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | OK — 182 files, 470 errors (baseline unchanged), `src/` clean |
| `npm run lint` (`biome ci .`) | exit 0 (23 pre-existing warnings; none in files this packet touched — the one hit under `src/generator/dotnet/` is `dto-mapping.ts:21`, last touched by `ee77e0af0`) |
| `node scripts/mission-counts.mjs --check` | OK (regenerated) |
| `node scripts/ledger-counts.mjs --check` | OK (regenerated) |
| `npm test` | see §7 |

---

## 4. Rows NOT built, and why

### 4.1 `#migrations` + `#schema-split` / `#schema-ignored` → **M-T2.17** (minted)

`docs/decisions.md` already carried the ruling (`D-DAPPER-ALTER`: build option
(c), with the widened refusal (b) as the interim) — so this was not owner-gated
for a DECISION; what it lacked was the "named T2 mission" the decision itself
requires. Minted with three slices: (b) the phase-⑨ widened refusal, (c) the
ordered `.sql` set applied by `DbSchema.EnsureAsync` behind a `__loom_migrations`
ledger + flipping the two `hasMigrations` guards, (d) the schema-PLACEMENT twin.

**Why this packet built none of it.** Slice (b) must live in phase ⑨ — the
derived diff it gates on only exists there (`fsSnapshotStore(outDir)`), i.e.
`src/system/**`, outside this fence. Slice (d) was folded in rather than left
unowned, with a recommendation recorded in the mission: qualify through the
connection's `search_path` (plus `CREATE SCHEMA IF NOT EXISTS`) rather than
threading a schema into every raw SQL string — the dapper emitter computes its
table name in eight places and none of them takes one, so the string-threading
road is where a missed site becomes a silent split-brain. **Two shapes need an
owner glance before (d) is built**: one deployable hosting two contexts on
DIFFERENT schemas (a `search_path` is per-connection and a shared table name is
then ambiguous), and `tablePrefix:`, which renames rather than places and needs
the names threaded after all.

Per the decision's own Consequences these close when
`test:migration-evolution-dapper` is green — not when a gate widens.

### 4.2 `loom.tph-filter-unsupported` → `scope`, **M-T6.72** (minted), `D-TPH-SUBTYPE-FILTER`

Repro run on fresh `main` first (it exits 1 with an accurate diagnostic). Decided
rather than built, and the size was MEASURED on the emitter, not estimated:
`_db.${setName}` × 19 in `emit/repository.ts`, plus 11 more `_db.` reads across
`find-emit.ts` / `criteria-emit.ts` / `query-projection-emit.ts` /
`spec-emit.ts`. All ~30 must carry the per-read predicate — a paged find's COUNT
as well as its PAGE, the by-id read, the bulk load, the write-scope guard, each
retrieval, each criterion Specification, each direct-table aggregation, and the
polymorphic base reader per concrete. A missed site is neither a compile error
nor a wrong-shaped answer: it is one read path returning rows a declared
restriction excludes. The decision also prices a cost the row does not mention —
a model filter is enforced by EF for EVERY query including hand-written ones the
customization gradient invites, a per-read `.Where` only where the emitter put
it — so M-T6.72 is scoped to move ONLY the filters that cannot be model-hosted.
**This one is worth an owner glance**: it is the packet's only re-class, and the
alternative (build it here) was rejected on risk, not on impossibility.

### 4.3 `find-predicate-unsupported` on dapper — already drained

`src/ir/util/find-predicate-capability.ts` sets `DAPPER_SUBSET = FULL_SUBSET`:
the adapter lowers the whole queryable subset, `this.<refColl>.contains(x)`
membership included, so the code narrows **mikroorm only**, on that one shape.
The register row's `what` still claimed `dapper|mikroorm`; corrected. The
mikroorm arm is packet **2c**'s.

---

## 5. Hand-offs and out-of-fence edits

### HAND-OFF → packet 2f (`src/ir/**`): `G2646-open-projection-on-event-no-channel`

**The dotnet arm is a no-op.** `grep -rn "\.channel\b" src/generator/dotnet/`
returns nothing — the .NET dispatcher builder never reads
`EventSubscriptionIR.channel`, so it needs no change at all. The entire fix is
`deriveEventSubscriptions`' early return at `src/ir/enrich/enrichments.ts:1303`
(`if (!channels || channels.length === 0) return []`) plus the two `if (channel)`
guards below it, exactly as `D-PROJECTION-IMPLICIT-SUB` describes.

**Measured, not asserted.** Applying that mechanism locally (a throwaway patch,
reverted; tree is clean) against a fixture with a `projection … on(Event)` and NO
`channel` anywhere: .NET goes from emitting no fold at all to emitting
`OrderBookOnOrderPlacedHandler.cs` + `OrderBookOnOrderShippedHandler.cs`, and the
project builds clean under `dotnet build /warnaserror`. So 2f can land the
enrichment without a paired dotnet change.

Two things for whoever lands it: `EventSubscriptionIR.channel` is a required
`string`, so making it optional ripples into every backend's dispatcher
builder — which is why it belongs in 2f's cross-backend fence and not here; and
the `loom.projection-event-uncarried` warning ("this fold never runs and the
read-model row is never written") becomes FALSE the moment it lands and must be
deleted in the same commit.

### HAND-OFF → M-T2.17 owner

Slices (b) and (d) above — `src/system/**` and `src/ir/validate/checks/migration-checks.ts`.

### Edits outside `src/generator/dotnet/**`, each with its reason

| file | why |
|---|---|
| `src/ir/validate/checks/orm-adapter-checks.ts` | the `#deep-scope` gate's own emission site — a `gap` row cannot close without deleting the arm that raises it (the register test requires every row still be emitted, and vice versa). Minimal hunk: one `for` loop replaced by a comment. |
| `src/diagnostics/messages.ts` | the `#deep-scope` message entry, orphaned by the above (`diagnostic-catalog.test.ts` fails an orphan). |
| `.github/workflows/tenancy-e2e.yml`, `package.json` | wiring the new boot leg — a proof the packet is required to produce (§3 rule 10) is worth nothing if it runs nowhere. |
| `test/system/gate-ledger.test.ts` | collateral: `DAPPER_UNSUPPORTED` was the ONE populated register keeping that file's vacuity guard meaningful, and this packet drains it. Repointed at `KNOWN_HEEX_GAPS`, chosen because it is SETTLED (D-DATAGRID-TARGETS) rather than pending, so it cannot drain out from under the guard the same way. |
| `test/system/ir-walk-census.test.ts` | deleting the waiver for the traversal this packet migrated (the ratchet's own rule). |
| `test/pairwise/waivers-compile.ts` | F12's dotnet half, measured stale by the leg's reverse ratchet. |
| `docs/decisions.md`, `docs/new-plan/{T2,T5,T6,README}.md`, `docs/audits/…ledger.{json,md}` | the dispositions and status flips the rows require. |

### Open PRs on this fence — overlaps

| PR | files | overlap |
|---|---|---|
| **#2852** (`envelope`) | `common.ts`, `dapper.ts`, `repository.ts`, `find-emit.ts` | **real, in `emit/dapper.ts`**. This packet's hunks there are localised: the import block, `authzFilterToSql`'s `scope` arm, `whereToSql`'s new self-scope pre-arm, the `FilterPrincipalRef` / `collectFilterPrincipalRefs` block, three small param helpers, and one `needsClaimGuid` splice in the relational repository's class body. None touches the `find`/`retrieval`/paged emission bodies #2852 works in. |
| **#2872** (optional value object) | `efcore.ts` | none — `efcore.ts` is untouched here. |
| **#2886** (workflow payload wire) | `dto-mapping.ts`, `workflow-emit.ts` | none. |
| **#2900** (`auth-emit.ts`) | `auth-emit.ts` | none — deliberately. The `__ClaimGuid` coercion was emitted as a private static on the repository class rather than as the `<Claim>AsUuid` accessor on the generated `User` record (the shape `guidClaimAccessorName` prescribes and java uses), specifically to keep this packet out of `auth-emit.ts`. **If the coordinator prefers the accessor, that is a clean follow-up** — the call site is one `valueExpr` in `collectFilterPrincipalRefs`. |

---

## 6. Decisions the owner may want to revisit

1. **`D-TPH-SUBTYPE-FILTER`** (new, `proposed`) — the only row this packet
   re-classed rather than built. §4.2.
2. **M-T2.17 slice (d)** — folding schema PLACEMENT in with the ALTER path is
   this packet's judgement, not a ruling; the mission says so and names the two
   shapes that need settling first. §4.1.
3. **`__ClaimGuid` placement** — repository-local vs the `User` accessor, above.

---

## 7. `npm test` on the merged tree

Run after `git merge origin/main` @ `9a8f2fe00`, per §3 rule 14. Result appended
below by the packet before hand-off; the wave log
(`docs/new-plan/waves/wave-c2.md`) is the live status.

One caveat on the run, stated rather than smoothed over: this container hosts
several wave packets at once, and a `npm test` started while two other sessions'
full runs were in flight reported a mass of `FAIL … [ file ]` transform errors
that all passed individually seconds later — resource contention, not a
regression. The reported run below is the one taken with the tree final.

**Result: green** — counts in the packet's final message.
