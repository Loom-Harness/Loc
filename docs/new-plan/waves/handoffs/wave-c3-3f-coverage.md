# Wave C3 · packet 3f — the remaining test-coverage missions

Branch `claude/c3-coverage`, cut from the C3 coordinator head `c3c2334de` (= `main` @ `d2a0bc02c` + the wave log + the 3a fold) and re-merged with it at `d7f38b229` (the 3c fold). Test-only: **no `src/` file is edited** — every `src/` mutation below was a file-copy seed, restored by file copy and re-checked with `git status --short src`. Two nightly workflows were added under `.github/workflows/` (the packet's fence), and each required ONE additive line in two non-nightly files — flagged for the coordinator in §"Fence crossings".

## Row → outcome

| mission | status before → after | outcome |
|---|---|---|
| **M-T9.39** i18n round-trip gate | `open` → **`done`** (archived) | `test/generator/_walker/i18n-round-trip.test.ts` — one fixture exercising every `USER_VISIBLE_SLOTS` role (completeness-pinned), both A13 shapes (an explicit `menu`; a `trigger:` Modal over an `OperationForm`), a `DestroyForm`, an enum form and a scaffold, on **15 frontend cells × {explicit, derived} menu**. Per cell, both directions computed then asserted as one object: (a) `deadKeys` — every catalog key read, quoted, outside the catalog files; (b) `uncatalogued` + `rawRendered` — every authored literal catalogued, every line rendering it carries its key; plus `rawOverMerged` — a dead key whose English IS rendered raw may never hide behind a design over-merge waiver. Backend half: node/.NET/java/python/elixir — every `msg.<hash>` in the runtime catalog is raised, every messaged rule (field `check`, invariant, param precondition, STATE precondition at the domain floor) is catalogued and raised. 24 ratcheting waivers (10 defects D-I18N-1..10 below, 14 documented over-merges from `_walker/i18n-chrome.ts`), per-cell and global stale arms. |
| **M-T9.29** primitive × frontend × pack census | `partial` → **`done`** (archived) | `test/generator/_walker/primitive-census.test.ts` DRIVES every cell: **58 walker primitives × 15 cells = 870** (probe table pinned complete against `walker-primitive-names.ts`). Each page: emitted, no give-up sentinel, the probe's witness text present. Registers: REFUSED (3 — DataGrid on flutter/HEEx, asserted by generating it and reading `loom.datagrid-unsupported-target`) and GAPS (26 silent, shrink-only, stale arm) = three defects D-CENSUS-1..3 below. The "four non-node compile legs" of the old status line had already shipped (#2690). |
| **M-T9.20** unit parity fill | `partial` → **`done`** (in place, `testing-quality-improvement-plan.md`) | file-upload on Vue/Svelte/Angular/Flutter → `test/generator/_frontend/file-upload-parity.test.ts` (8 pack cells; the upload path read off the node backend's own route table, the multipart part name off its `body["file"]`); ACL on all six → `test/generator/_frontend/server-error-acl-parity.test.ts` (each target's emitted mapper EXECUTED against a booted backend's 422 — the `absent-optional` wire golden; only React maps it — D-ACL-1..5); java migrations → `test/generator/java/java-migrations-emit.test.ts` (Flyway's own file-name grammar). Already on `main`: the hono timer test (`test/platform/hono-timer-scheduler.test.ts`), both sourcemap rows (`test/generator/{feliz,flutter}/sourcemap.test.ts`). The flutter/feliz per-kind `ExprIR` pinning tail is M-T9.14's (packet 3b). |
| **M-T9.48** residue | `partial` → **`done`** (archived) | `test/ir/collection-op-{lambda-element-type,let-type}.test.ts` on `parseValid`, their two `PARSE_STRING_ALONGSIDE` waivers deleted (`test/system/legacy-generate-path-ratchet.test.ts`); `test/generator/typescript/retrieval-emit.test.ts` pins the `loads:` fixture is refused by EXACTLY `loom.retrieval-loads-unsupported`. |
| **M-T9.17** slice 2 | `partial` → **`done`** (in place) | The mission's premise was stale: every slice-2 module already had a direct test since 2026-08-31 under `test/ir/lower/` + `test/ir/util/`. Added the unpinned remainder over parsed + lowered fixtures: `repoReadResultType`'s whole table and the matchers' page/criterion-arg shapes (`test/ir/lower/repo-read.test.ts`), and four of `aggregate-flags.ts`'s six predicates (`test/ir/util/aggregate-flags.test.ts`). |
| **M-T9.23** size + boot budget | `open` → **`done`** (archived) | `.github/workflows/size-boot-budget.yml` (nightly / `run-size-boot` / dispatch) → `test/e2e/size-boot-budget.test.ts` → `test/budget/size-boot-ratchet.ts` against `test/budget/size-boot-budget.json`; two-way ratchet (growth AND shrink past tolerance fail). Bundles pinned from local builds: react/mantine **350025**, vue/vuetify **382972**, svelte/flowbite **339403**, angular/primeng **292617** gzip bytes. **Residue:** the five boot cells are `unpinned` (reason in the file) — the sandbox's docker builds cannot reach npm/PyPI/NuGet/Maven/hex through its proxy (`/root/.ccr/README.md` "docker build"); an unpinned cell FAILS the run that measures it, naming the value, so the first nightly is red once per boot cell by design. |
| **M-T3.14** SAST | `open` → **`done`** (archived) | `test/sast/loom-auth-tenancy.yml` (semgrep 1.178), `.github/workflows/sast-generated.yml` (nightly / `security` / dispatch) → `test/e2e/sast-generated.test.ts`: the authorization/tenancy corpus (derived from the sources) + `test/sast/fixtures/leak-shapes.ddd` on every targeted backend; forbidden rules vs a 3-row triage ratchet, required rules on the OIDC fixture, 9 SEEDS re-proved every run (`test/sast/registers.ts`). Complements, does not duplicate, 3c's emitted-source census (M-T9.41): a second mechanism over the same text. |

## Mutation proofs (each seeded, the named assertion failed, restored by FILE COPY)

- **M-T9.48** — re-adding a `PARSE_STRING_ALONGSIDE` row fails *"every `parseString` → legacy-generate file carries a stated reason"* (1 stale); `query-checks.ts:320` guard `&& false` fails the new pin (*expected [] to equal ['loom.retrieval-loads-unsupported']*); a duplicate field in `collection-op-let-type`'s fixture now fails with *unexpected validation errors*.
- **M-T9.17** — `repo-read.ts` `findById` typed bare → *"the built-ins split by shape"*; the `run` arm reading `retrievalArgs` for an anon criterion → *"run(<Criterion>(args)) rides the anonymous …"*; `aggregate-flags.ts` destroy half dropped → *"is false with a reference but NOTHING deletable"*; parts disjunct dropped → *"a PART's X id field counts"*; `unwrapType` skipped → the SELF-reference + declaration-order cases.
- **M-T9.20** — `typescript/emit/routes.ts` upload route renamed `/uploads` → 8 cells *"uploads somewhere the backend does not mount: expected '/files' to be '/uploads'"*; flowbite `primitive-file-upload.hbs` write-back dropped → *"svelte/flowbite standalone FileUpload (b): the FileRef is not written back"*; `react/emit-templates.ts:139` `pointerToFlat` skipped → *"react: the 422 did not land on the form field (expected {/estimate} to equal {estimate})"*; `emitJavaMigrations` without `.<n>` → four cases incl. *"expected 1 to be 3"* (duplicate Flyway versions); `sanitize` dropped → the description case.
- **M-T9.39** (twice, as the mission demands) — **dead-key direction:** `_frontend/menu-emitter.ts:275` explicit-link `labelKey` dropped (the A13b revert) → 14 explicit cells, `deadKeys: ["menu.link.pmpret"]` (+ the raw line); **raw-render direction:** `_walker/primitives/forms.ts:1064` Modal trigger read with i18n off (the `t()` wrap removed) → 16 cells, `rawRendered: [SlotModalTrigger @ product_admin.tsx]`; **backend:** `_i18n/domain-floor.ts` `domainFloorCode` dropping one rule → node/.NET/java/python fail (elixir raises the domain-floor code on its own path — noted, not a gap).
- **M-T9.29** — flowbite `primitive-card.hbs` `{{{titleText}}}` removed → *"svelte/flowbite … content dropped: no \"CardTitle\""*; a GAPS row on a rendering cell → *"registered gaps that render now — delete them"*.
- **M-T9.23** — react baseline seeded to 300000 → the measuring leg fails *"350028 exceeds the budget 300000 by 16.7% (limit 315000)"* (a real `npm install` + `vite build`); the shrink arm disabled → *"fails a SHRINK past the tolerance too"*.
- **M-T3.14** — in the gate every run: 9 seeds (F2-ADP-1/ef, A1 × node/python/java/elixir, a literal client secret, a logged access token, the `state` check removed, the PKCE verifier removed) each named. In `src/`: `dotnet/find-emit.ts:32` → `if (bypass.bypassAll) return ".IgnoreQueryFilters()";` fails *"untriaged SAST findings"* naming `sast~leak-shapes/dotnet/…/SecretRepository.cs`; `hono/v4/projection-query-routes-builder.ts:211` `drizzleCapabilityPredicates` push removed fails naming 6 aggregation reads (4 in `projection-agg-filters`, 2 in the leak-shape fixture).

## Defects handed off (test-only packet — none fixed here; each is a ratcheting waiver/register row that fails when fixed without deletion)

**i18n (M-T9.39) — `test/generator/_walker/i18n-round-trip.test.ts` `DEAD_KEY_WAIVERS`:**
- **D-I18N-1** (all 15 cells) — a scaffold page's `menu:` sidebar metadata is extracted (`_walker/i18n-extract.ts` ~:234, "Per-page sidebar chrome") as `page.List.menu.{section,label}.<hash>`, but no DERIVED sidebar reads it: the JSX shells render it raw (`<NavLink … label="Products" />`, `<div className="loom-nav-section">Aggregates</div>` — react/vue/svelte confirmed raw). Suspect the key the menu builder computes (`_frontend/menu-emitter.ts:234/244`, `messageKey(\`page.${p.name}\`, …)`) against the scaffold page's role-scoped name. #2667 closed A13(b) for the explicit `menu {}` only.
- **D-I18N-2** (vue ×2, angular ×3, feliz, flutter, HEEx ×2) — `DestroyForm` renders "Delete Product" / "Delete this product?" raw; `_walker/primitives/forms.ts:203/208` (`localizedPageChrome*`) is honoured by React and Svelte only.
- **D-I18N-3** (vue ×2, angular ×3) — the 404 route renders "Not found" raw.
- **D-I18N-4** (feliz, flutter) — the root error view renders "Something went wrong." raw.
- **D-I18N-5** (angular ×3) — a bool cell renders Yes/No raw while the catalog carries `pack.<ng>.bool{True,False}`.
- **D-I18N-6** (HEEx ×2) — the list pager renders its position counter raw; neither `chrome.prev` nor `chrome.next` is read.
- **D-I18N-7** (feliz) — the catalog carries the DEFAULT pack's (`pack.mantine.*`) form chrome, 8 keys no Feliz view can read (Feliz has no pack).
- **D-I18N-8** (feliz) — a `trigger:` Modal's (and the scaffold detail op-modal's) `title:` is catalogued but never rendered (the open/close Modal form is fine).
- **D-I18N-9** (feliz, flutter; explicit menu) — an explicit `menu {}` is extracted but never rendered.
- **D-I18N-10** (HEEx ×2; explicit menu) — the sidebar renders an explicit menu's links but drops its section heading.
- Observation, not waived: a `Modal { trigger: …, DestroyForm { … } }` passes validation and degrades to `loom:unrendered [loom.page-primitive-arg-invalid]` while its strings stay catalogued — the fixture uses the valid `OperationForm` child instead.
- #2969 (F-034, the i18n locale wiring, `src/` fix in flight) is **cited, not fixed**; this gate checks key↔consumption, not locale selection, so it neither blocks nor is blocked by #2969.

**Primitive census (M-T9.29) — `test/generator/_walker/primitive-census.test.ts` `GAPS`:**
- **D-CENSUS-1** (all 15 cells) — a ROW-scoped `Action { o.<op> }` (in a `Table` column or a `For` lambda) validates, then renders `loom:unrendered [loom.page-ref-unreachable] Action(o.activate): 'o' is not an in-scope aggregate instance` (Angular spells it `loom.page-primitive-arg-invalid`). The walker resolves only a component-param / detail-record instance; phase ⑦'s `loom.unresolved-page-ref` does not reach an op-ref through a lambda row. Repro: the census's `Action` probe.
- **D-CENSUS-2** (vue ×2, angular ×3, feliz, flutter, HEEx ×2) — `Avatar { alt: "…" }` without `src:` drops its `alt` (`<v-avatar></v-avatar>`) — the element's accessible name is lost; React keeps it.
- **D-CENSUS-3** (HEEx ×2) — a component call's children are dropped: `Framed { Text { "slotted" } }` emits `<…UiComponents.framed />`, so the component's `Slot {}` renders nothing.

**ACL (M-T9.20) — `test/generator/_frontend/server-error-acl-parity.test.ts` `WAIVERS`:**
- **D-ACL-1** (vue) — `lib/form.ts` `applyServerError` tests `"errors" in err` on the thrown `ApiError` (whose ProblemDetails is on `.body`) and reads `errors` as a field-keyed record; every 422 lands on `__global` (`{__global: 'Validation failed'}`).
- **D-ACL-2** (svelte) — `lib/forms.svelte.ts` `applyServerErrors` unwraps `.body` but reads `errors` as a record; `Object.entries` of the wire's ARRAY skips every entry (`{}`).
- **D-ACL-3/4/5** (angular, feliz, flutter) — no mapper: Angular's CreateForm awaits `mutateAsync` with no catch; Feliz's HTTP helper returns `Error (sprintf "HTTP %d")`, dropping the body; Flutter's `lib/forms.dart` sets `'Request failed (<status>)'` and never decodes the body (and ships that sentence untranslated).

**M-T9.17** — `src/ir/lower/id-follow.ts` `collectIdFollows` / `idFollowPath` / `orderAuxiliaries` have **no `src/` caller** (only `joinRefPath` + `mapVarForPath`, used by `lower-projection.ts:52`) — dead code kept alive by its tests; a deletion for a `src/` packet (`collectIdFollows` is also a hand-rolled IR walk the ir-walk census would otherwise have to carry).

## Fence crossings (for the coordinator to compose)

The two new nightlies are `pull_request`-triggered on their label, which three completeness gates require to be registered. Each is ONE additive line in a file outside the "nightlies only" fence — 3e (PR 3-B) owns `.github/workflows/**` otherwise:
- `.github/workflows/pr-gate.yml` `workflow_run.workflows` += `'Generated size + boot budget'`, `'SAST over generated auth + tenancy'` (demanded by `test/system/pr-gate.test.ts`);
- `.github/workflows/ci-red-alarm.yml` watch list += the same two names (demanded by `test/system/main-red-alarm-coverage.test.ts`);
- `docs/testing.md` local-run rows + `.claude/skills/loom-ci-gates/SKILL.md` rows + the `run-size-boot` / `security` label rows (demanded by `local-run-mapping.test.ts` and the packet brief).

Neither label exists on the repo yet: `run-size-boot` and `security` must be created for the label path to fire (the schedule and dispatch paths need nothing).

## Registers / ratchet numbers

- M-T9.39: 30 frontend cells + 5 backends; `DEAD_KEY_WAIVERS` 24 (10 defect, 14 over-merge).
- M-T9.29: 870 cells; REFUSED 3; GAPS 26 (15 + 9 + 2).
- M-T9.20: ACL `WAIVERS` 5 (of 6 frontends); file-upload 8 cells, 0 waivers.
- M-T9.48: `PARSE_STRING_ALONGSIDE_HONO` 8 → 6, `_DOTNET` 4 → 3.
- M-T3.14: forbidden 7 + required 2 rules; `TRIAGE` 3; `SEEDS` 9.
- M-T9.23: 9 cells; 4 pinned, 5 unpinned-with-reason.

## Local gates (on the merged tree)

See the final section appended at hand-off time.

## Open-PR overlaps

- #2976 / #2977 / #2978 / #3024 — 3a's fenced drains; nothing here touches their fixtures.
- #2969 — i18n locale wiring (F-034); cited above, not fixed.
- Sibling packets: 3c's emitted-source census (folded into this head) proves the same two leaks by a read-site census; the SAST ruleset is the independent second mechanism and reuses its reseed points (not its code). 3d's corpus promotion — no overlap (no `test/generator/**` deletion here; `java-migrations-emit.test.ts` and the two `_frontend/` files are additive). 3b owns M-T9.14's flutter/feliz per-kind `ExprIR` tail.
