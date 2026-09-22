# Wave C4 hand-off — 4c the uncoded validator-conditions drain (M-T9.56, drain half)

*Branch `claude/c4-uncoded`, cut from `main` @ `a45fc948b` and merged with the
C4 coordinator head `0a00c3723`.*

**One line:** the 128 uncoded diagnostic sites the C1 ratchet pinned are **0**;
`test/system/diagnostic-uncoded-baseline.ts` is **deleted**; both halves of the
M-T9.56 gate are now absolute rather than shrink-only, and both are
mutation-proved. `UNDOCUMENTED_CODES` never grew — its pinned length is
unchanged at **365**, because every one of the 108 minted codes carries a live
language-reference anchor.

---

## 1. The drain, per validator file

Seven commits, largest file first. "sites" is the per-file row in
`diagnostic-uncoded-baseline.ts`; "codes" is how many `loom.*` codes those
sites were given (fewer than sites wherever two call sites state one rule).

(The commit subjects read `drain 1/12` … `drain 6/12` and then `drain 7/7`: the
plan budgeted ~10–12 slices, the drain closed in **seven** because four files
turned out to share condition families with a larger one and two more were small
enough to fold together. The table below is the authoritative mapping.)

| commit | file | sites before → after | codes | notes |
|---|---|---:|---:|---|
| 1/12 `c7a34b379` | `src/language/validators/deployable.ts` | **24 → 0** (row deleted) | 21 | `loom.ui-binding-unknown-param` covers 2 sites; `loom.ui-binding-missing` carries `#no-compose` + `#param` |
| 2/12 `10a454cb8` | `src/language/validators/statements.ts` | **22 → 0** (row deleted) | 21 | plus the two cross-file families below |
| ” | `src/language/validators/repository.ts` | **1 → 0** (row deleted) | — | `loom.requires-not-bool` family |
| ” | `src/language/validators/toplevel-function.ts` | **1 → 0** (row deleted) | — | `loom.function-return-type-mismatch` family |
| ” | `src/language/validators/structural.ts` | **7 → 6** | — | `loom.requires-not-bool` family |
| ” | `src/language/validators/types.ts` | **15 → 12** | — | both families (1 `requires`, 2 function-return) |
| 3/12 `2ebb84071` | `src/language/validators/ui.ts` | **21 → 0** (row deleted) | 20 | `loom.layout-slot-duplicate` carries `#main` + the named-slot form |
| 4/12 `e14e409a8` | `src/language/validators/types.ts` | **12 → 0** (row deleted) | 12 | + the vacuous-pass guard rework (§4) |
| 5/12 `3e04f4a1a` | `src/language/validators/match.ts` | **12 → 0** (row deleted) | 11 | `loom.matcher-e2e-only` carries `#same-instant` + `#throw-status` |
| 6/12 `f9c5092e5` | `src/language/validators/datasource.ts` | **9 → 0** (row deleted) | 3 | three RULES, nine `#slug`s |
| ” | `src/language/validators/traceability.ts` | **9 → 0** (row deleted) | 8 | `loom.requirement-property-missing` carries `#type` + `#title` |
| 7/7 `188c0c611` | `src/language/ddd-validator.ts` | **6 → 0** (row deleted) | 5 + 1 reused | the sixth is `loom.duplicate-theme-block#system-scope` |
| ” | `src/language/validators/structural.ts` | **6 → 0** (row deleted) | 6 | 2 of them UNREACHABLE (§5) |
| ” | `src/language/validators/_shared.ts` | **1 → 0** (row deleted) | 1 | one forwarding helper, `warnSensitivityDrop` |
| | **total** | **128 → 0** | **108 minted + 1 reused** | 120 catalog KEYS |

`UNCODED_TOTAL` and `UNCODED_SITES` are gone with the file; the scanner
(`uncodedSitesIn` in `diagnostic-catalog.test.ts`) reports an empty census on
this tree.

### Codes carrying several `#slug`s (one rule, several sentences)

| code | slugs | why one code |
|---|---|---|
| `loom.resource-knob-kind-mismatch` | `#ttl` `#every` `#retain` `#isolation-on-cache` | one rule: "this knob does not suit this resource `kind:`" |
| `loom.resource-knob-storage-mismatch` | `#schema` `#table-prefix` `#key-prefix` `#isolation` | one rule: "this knob does not suit this storage's type" |
| `loom.ui-binding-missing` | `#no-compose` `#param` | whole compose block absent vs one parameter unbound |
| `loom.unresolved-member` | *(bare)* `#on-type` | the mid-chain step cannot name the receiver type, the last one can |
| `loom.matcher-e2e-only` | `#same-instant` `#throw-status` | "this matcher is wire-level, so it needs the e2e tier" |
| `loom.layout-slot-duplicate` | `#main` *(bare)* | `main` is a distinct grammar node, same "declare each slot once" rule |
| `loom.requirement-property-missing` | `#type` `#title` | the two required properties |
| `loom.duplicate-theme-block` | *(existing)* `#system-scope` | **reused**, see §2 |

---

## 2. The duplicate pairs unified

The C1 hand-off §7 named two condition FAMILIES and warned that draining one
member of a family leaves an incoherent surface ("slice by condition family,
not by file"). Both were drained as a family, in commit 2/12:

| code | sites unified | files |
|---|---|---|
| **`loom.requires-not-bool`** | 5 | `statements.ts` (the `operation … requires` gate + the in-body `requires` statement), `structural.ts` (the workflow `create`/`handle` gate), `repository.ts` (the read-path find / query-time projection gate), `types.ts` (the handler-body statement) |
| **`loom.function-return-type-mismatch`** | 3 | `toplevel-function.ts` (the top-level expression-form function), `types.ts` (the member function's expression body, and its block-body `return`) |

A third re-statement was found while draining and reused rather than minted:

| code | sites | files |
|---|---|---|
| **`loom.duplicate-theme-block`** (`#system-scope`) | 2 | `composition.ts` counts `theme { … }` blocks across every file that composes into the project (existing, coded); `ddd-validator.ts` counts them inside one `system` block (this drain) |

That reuse also let `loom.duplicate-theme-block` **leave `COVERED_ELSEWHERE`**
in `diagnostic-firing-census.data.ts` — which that list's own header allows
exactly this way ("a code may leave this list only by gaining a fixture in
`FIRING_FIXTURES`"), replacing a one-off 2026-08-13 measurement with a proof
that runs every time.

Two more pairs were considered and deliberately kept SEPARATE, recorded here so
the next reader does not re-open them:

- `loom.property-default-type-mismatch` vs `loom.parameter-default-type-mismatch`
  — same shape, different declaration kind, and a fix hint for one ("move it
  into `create`") is nonsense for the other.
- The three "modifier on a private operation" warnings (`audited` / `when` /
  `requires`) — the shared half ("no HTTP entry point") is the REASON; each
  names a different thing the private operation loses.

---

## 3. The codes minted, with their anchors and fixtures

Every code below has three things in the same commit: its wording in
`src/diagnostics/messages.ts`, a **live** `code-docs.ts` anchor (verified
against the real heading by `diagnostic-docs-anchors.test.ts`), and a
`FIRING_FIXTURES` entry that makes it come out of `validate()`. **No code was
parked in `UNDOCUMENTED_CODES`**, so its pinned length is untouched at 365.

### `deployable.ts` → 21 codes

`loom.static-deployable-missing-ui` · `loom.frontend-targets-missing` ·
`loom.frontend-targets-invalid` · `loom.frontend-contexts-ignored` ·
`loom.targets-misplaced` · `loom.platform-unknown` ·
`loom.platform-version-unknown` · `loom.design-pack-ignored` ·
`loom.design-theme-unknown` · `loom.design-pack-custom-unchecked` ·
`loom.design-pack-version-unknown` · `loom.design-pack-format-mismatch` ·
`loom.datasource-context-unlisted` · `loom.datasource-duplicate` ·
`loom.serves-on-frontend` · `loom.serves-unknown-api` ·
`loom.serves-duplicate-api` · `loom.ui-binding-unknown-param` ·
`loom.ui-binding-duplicate` · `loom.ui-binding-unknown-source` ·
`loom.ui-binding-source-not-serving` · `loom.ui-binding-missing`

Anchors: `02-systems-and-topology.md#deployable` / `#backend-platforms` /
`#frontend-platforms--targets` / `#design-packs`,
`14-apis-storage-resources-channels.md#resource` /
`#serves-and-the-openapi-document`,
`15-ui-pages-structure.md#ui-block--deployable-binding`.
Fixtures: one shared `topology(extra, opts)` base — a clean node deployable
serving one api over one context, plus the extra deployable or knob that IS the
defect.

### `statements.ts` → 21 codes

`loom.audited-private-operation` · `loom.when-private-operation` ·
`loom.requires-private-operation` · `loom.when-not-bool` ·
`loom.requires-not-bool` · `loom.precondition-not-bool` ·
`loom.retrieval-where-not-criterion` · `loom.assign-to-derived` ·
`loom.assign-type-mismatch` · `loom.collection-mutation-non-collection` ·
`loom.collection-mutation-element-type` · `loom.emit-field-type` ·
`loom.emit-field-missing` · `loom.operation-self-call` ·
`loom.unresolved-call` · `loom.unresolved-member` ·
`loom.member-not-callable` · `loom.bare-statement-invalid` ·
`loom.unresolved-lvalue-head` · `loom.function-return-type-mismatch`

Anchors: `06-behavior-and-statements.md#let--emit` /
`#guards--requires-403-vs-when-409-vs-precondition-422` / `#assignment-----` /
`#operation--a-mutating-method`, `05-expressions.md#member-access--calls`,
`07-invariants-derived-functions.md#function--a-pure-helper`,
`10-repositories-and-queries.md#retrieval`,
`22-macros.md#audit--the-built-in-capability-auditable`.
Fixtures: `orderOps(members)` — one aggregate carrying a derived field, a
collection, a value-object member and an event, so each fixture is one line.

### `ui.ts` → 20 codes

`loom.theme-property-unknown` · `loom.theme-property-duplicate` ·
`loom.theme-color-invalid` · `loom.theme-radius-invalid` ·
`loom.theme-color-scheme-invalid` · `loom.ui-page-duplicate` ·
`loom.ui-menu-duplicate` · `loom.ui-api-param-duplicate` ·
`loom.ui-api-unknown` · `loom.ui-param-duplicate` ·
`loom.ui-function-duplicate` · `loom.page-property-duplicate` ·
`loom.page-menu-key-unknown` · `loom.page-layout-unknown` ·
`loom.menu-link-property-unknown` · `loom.ui-api-aggregate-unknown` ·
`loom.ui-api-operation-unknown` · `loom.layout-name-reserved` ·
`loom.layout-main-slot-missing` · `loom.layout-slot-duplicate`

Anchors: `02-systems-and-topology.md#theme`,
`15-ui-pages-structure.md#page--route-title-body` / `#area--menu` /
`#ui-block--deployable-binding` / `#layout--named-app-frames`.
Fixtures: `themed(props)` and `uiMembers(members, { layouts })`.

Every menu these messages quote is now **derived** from the same `Set` the
check tests against and passed as a param, so the sentence can no longer drift
from the rule (it previously re-typed the theme property list, the radius set
and the colorScheme set by hand).

### `types.ts` → 12 codes

`loom.operator-non-bool-operands` · `loom.operator-operand-mismatch` ·
`loom.convert-aggregate-no-display` · `loom.convert-non-primitive` ·
`loom.convert-pair-invalid` · `loom.property-check-not-bool` ·
`loom.mask-unless-not-bool` · `loom.property-default-type-mismatch` ·
`loom.parameter-default-type-mismatch` · `loom.invariant-not-bool` ·
`loom.invariant-guard-not-bool` · `loom.derived-type-mismatch`

Anchors: `05-expressions.md#comparison-logical--unary` /
`#arithmetic--widening` / `#conversions`,
`07-invariants-derived-functions.md#invariant--a-checked-predicate` /
`#when--a-conditional-invariant` / `#mask-unless--field-read-redaction` /
`#derived--a-computed-read-only-field`,
`03-domain-modeling.md#fields-property`,
`06-behavior-and-statements.md#operation--a-mutating-method`.
Fixtures: `orderTypes(member)`.

**One trap worth naming.** The two operator sites pass their accept options
through a shared `info` VARIABLE. Both scanners only read a `code` out of an
object LITERAL, so `accept(…, info)` with a code added upstream would have been
invisible to the coded census AND counted as uncoded. The sites spread instead:
`{ ...info, code: "…" }`.

### `match.ts` → 11 codes

`loom.match-empty` · `loom.match-no-else` · `loom.matcher-arity` ·
`loom.expect-requires-matcher` · `loom.matcher-e2e-only` ·
`loom.tothrow-arity` · `loom.tothrow-status-not-int` · `loom.matches-arity` ·
`loom.matches-named-arg` · `loom.matches-not-literal` ·
`loom.matches-invalid-regex`

Anchors: `05-expressions.md#ternary--match` / `#scalar-intrinsics`,
`18-testing.md#matchers--the-expectactualmatcher-vocabulary` /
`#tothrow--the-throw-assertion`.
Fixtures: `matcherTest(expectStmt)`; `loom.tothrow-status-not-int` needs the
OPPOSITE tier so it carries its own `test e2e` system.

`loom.match-no-else` joined `PROSE_SAYS_UNDEFINED` in
`diagnostic-message-hygiene.test.ts`, next to its variant-match twin and for the
same reason: the message says the expression evaluates to `undefined`, which is
the defect it describes, not a template reaching one hop too far.

### `datasource.ts` → 3 codes, `traceability.ts` → 8 codes

`loom.resource-kind-storage-mismatch` · `loom.resource-knob-kind-mismatch` ·
`loom.resource-knob-storage-mismatch` ·
`loom.requirement-property-unknown` · `loom.requirement-property-duplicate` ·
`loom.requirement-type-invalid` · `loom.requirement-status-invalid` ·
`loom.requirement-title-not-string` · `loom.requirement-priority-not-int` ·
`loom.requirement-property-missing` · `loom.requirement-parent-cycle`

Anchors: `14-apis-storage-resources-channels.md#the-kind--storage-matrix` /
`#the-knobs-and-their-guards`, `19-requirements-traceability.md#requirement` /
`#relations-summary`.
Fixtures: `resourced(resources)` and `requirements(decls)` (a `requirement` is
a Model member, not a system member, so it sits outside the `system` block).

Same derivation fix as `ui.ts`: the allowed requirement keys, the four
requirement types and the four statuses are now read off the `Set`s the checks
test against instead of being re-typed in three sentences.

### `ddd-validator.ts` → 5 codes + 1 reused, `structural.ts` → 6, `_shared.ts` → 1

`loom.duplicate-ui` · `loom.duplicate-api` · `loom.api-unknown-subdomain` ·
`loom.duplicate-storage` · `loom.duplicate-resource` ·
`loom.duplicate-theme-block#system-scope` *(reused)* ·
`loom.audited-no-command` · `loom.duplicate-entity-part` ·
`loom.duplicate-derived` · `loom.valueobject-contains-entity` ·
`loom.containment-optional-collection` · `loom.containment-foreign-part` ·
`loom.sensitivity-drop`

Anchors: `14-apis-storage-resources-channels.md#api` / `#storage` /
`#resource`, `15-ui-pages-structure.md#ui-block--deployable-binding`,
`03-domain-modeling.md#entity-parts--contains` / `#valueobject` /
`#sensitive`, `04-type-system.md#x-id--cross-aggregate-references`,
`07-invariants-derived-functions.md#reserved-display-and-inspect`,
`22-macros.md#audit--the-built-in-capability-auditable`.
Fixtures: `systemScope(members)` and `aggShape(modifiers, members)`.

`_shared.ts`'s single row is `warnSensitivityDrop`, the one FORWARDING helper
in the census — the drain touched the helper, not its five callers, exactly as
the C1 hand-off §7 predicted the 1 → 0 move would work.

---

## 4. Two gates changed shape, both deliberately

### (a) invariant 5's vacuous-pass guard stopped counting debt (commit 4/12)

It read `expect(ALL_UNCODED.length).toBeGreaterThan(50)`. That counted LIVE
offenders, which made it a second, unlabelled ratchet running the WRONG way:
every slice had to lower it, and at zero — the drain's whole point — it would
have had to be deleted, taking the vacuous-pass protection with it. (It did in
fact fail at 43, which is how it was found.)

The scanner is now split into a source-taking `uncodedSitesInSource(file, src)`
and the guard drives it with a fixture holding one of each shape — an
`accept` with options but no `code`, an `accept` with no options at all, an
uncoded `{ severity, message }` object literal, and the CODED twins of the
first and the last — asserting it sees exactly the three uncoded ones. That is
a property of the SCANNER, so it holds at any debt level, including none.

### (b) the ratchet became an absolute gate (commit 7/7)

- `test/system/diagnostic-uncoded-baseline.ts` **deleted**, and its two imports
  (`diagnostic-catalog.test.ts`, `diagnostic-firing-census.test.ts`) with it.
- Invariant 5 is now one assertion: *no diagnostic site reaches the user
  without a `loom.*` code*, failing with the offender's file, line, severity and
  source text, and a message listing what a new code owes.
- The `loom.unknown` half dropped its `FIXTURES_RAISING_UNKNOWN` waiver table,
  which shipped empty. A waiver kept past the debt it waived is slack
  (`allowlist-ratchet.test.ts`, same rule).

The two halves are NOT redundant and both were kept: the site census reads the
validator SOURCES; the `loom.unknown` assertion reads what `validate()` actually
hands a caller, so it also covers a diagnostic built somewhere the AST scanner
does not look, and it is the half that would notice if `report.ts` started
synthesising the code for a new reason. The comment above it now says so.

---

## 4b. Three codes had to be RENAMED — a code name is a claim

Caught by the full `npm test` (nothing lighter reaches it):
`test/system/unsupported-register.test.ts` scans all of `src/` for a `code:`
whose value **ends in `-backend`** or **contains `unsupported`**, and demands a
classified row in `src/diagnostics/unsupported-register.ts` for each — that
register is the "this backend does not implement this feature yet" ledger, and a
`gap` row there is a commitment under the no-permanent-skips policy.

Three of the first-draft names matched that heuristic while meaning nothing of
the sort:

| first draft | renamed to | what it actually says |
|---|---|---|
| `loom.frontend-targets-not-backend` | **`loom.frontend-targets-invalid`** | a frontend deployable's `targets:` names another frontend |
| `loom.targets-on-backend` | **`loom.targets-misplaced`** | `targets:` was written on a backend deployable at all |
| `loom.convert-unsupported` | **`loom.convert-pair-invalid`** | this (source, target) pair is not in the conversion vocabulary |

Registering them would have been the wrong fix — it would have added three fake
platform-gap rows and moved `MAX_OPEN_GAPS` (pinned at 16 by the wave log for
drift). Renaming keeps that pin and the `LATENT_SEAMS` 27 untouched, and the new
names read better anyway (`loom.targets-misplaced` mirrors its sibling
`loom.auth-ui-misplaced` in the same file).

The rule is now written where the next author will hit it — a comment above the
first of the three in `messages.ts` says a code may not end in `-backend` or
contain `unsupported` unless it is a genuine platform-gap row.

---

## 5. Two codes are UNREACHABLE, and are pinned rather than deleted

Found by trying to write their firing fixtures — which is the point of the
fixture requirement.

| code | why it cannot fire | pin |
|---|---|---|
| `loom.valueobject-contains-entity` | `ValueObjectMember` is `Property \| DerivedProp \| Invariant \| FunctionDecl \| TestBlock` — a `contains` in a `valueobject` is a PARSE error, so `checkValueObject`'s `isContainment(m)` arm never sees one | `UNREACHABLE_PINS` |
| `loom.containment-foreign-part` | the custom scope provider restricts a containment's `partType` to entity parts of the SAME aggregate, so a cross-aggregate part never LINKS: the check's own `if (!part) return;` fires first and the author gets a linking error naming the unresolved part | `UNREACHABLE_PINS` |

Both arms were left in place rather than deleted: the `src/api/` toolkit and the
playground can hand the validator an un-linked model, and the second arm's own
comment already calls itself a "friendly double-check". **Decision wanted from
the owner:** whether a future slice should delete both arms and their catalog
entries outright. It is a two-line change either way; the pins record the
finding so it is not re-discovered.

---

## 6. Mutation proofs (file-copy backup + `cp` restore, never `git checkout --`)

Both surviving halves of the gate, each naming the assertion that failed.

| # | mutation | assertion that failed | evidence |
|---|---|---|---|
| **a** | seeded one uncoded site into `src/language/validators/repository.ts`: `accept("error", \`seeded uncoded condition on this gate\`, { node, property: "gate" })` | `uncoded diagnostic sites — none, and none may return (M-T9.56) > no diagnostic site reaches the user without a \`loom.*\` code` | the failure NAMED the site: `src/language/validators/repository.ts:37 [error] accept("error", \`seeded uncoded condition on this gate\`, { node, property: "gate", })` |
| **b** | reverted the `operation … requires` gate site in `src/language/validators/statements.ts` to its pre-drain inline form | `the generic code \`loom.unknown\` reaches no user > loom.requires-not-bool's fixture raises no uncoded diagnostic` | received `["error: 'requires' must be of type 'bool', got 'string'."]`; `every fixture raises the code it claims > loom.requires-not-bool fires` failed alongside |

Mutation **a** is the proof the packet brief asked for ("seed one uncoded
`accept("error", …)` in a validator by file copy and quote the failure").
Mutation **b** proves the SECOND half separately, because **a** alone does not
reach it — `repository.ts`'s read-path gate is not the site
`loom.requires-not-bool`'s fixture drives, so the firing census stayed green
under **a**. That asymmetry is itself worth recording: the two halves cover
different things, which is why both survive.

Both files restored by `cp` from the backups in the scratchpad; the scanner
reports **0** uncoded sites afterwards and the four diagnostic suites are green
(787 tests).

---

## 7. Gates run on the merged tree

| command | result |
|---|---|
| `npx tsc -b` | clean |
| `node scripts/test-typecheck.mjs` | see §8 — **untouched by this packet** (it is 4b's ratchet) |
| `npm run lint` (`npx biome ci .`) | exit 0 |
| `npx vitest run test/system/diagnostic-{catalog,firing-census,message-hygiene,docs-anchors}.test.ts` | **787 passed**, 4 files |
| `node scripts/mission-counts.mjs --check` | up to date (regenerated with `--write` after flipping M-T9.56) |
| `node scripts/ledger-counts.mjs --check` | `.md` matches the JSON |
| `node docs/build.mjs` | exit 0 |
| `npm test` (redirected, exit code appended) | first run **1 failed / 25 715 passed** (`unsupported-register.test.ts`, §4b) → fixed by the three renames; the four diagnostic suites + `unsupported-register` re-run **796 passed** |

Pins, all moved DOWN or held, never up:

| pin | before | after |
|---|---:|---:|
| uncoded validator sites (`UNCODED_TOTAL`) | 128 | **0** (file deleted) |
| `UNDOCUMENTED_CODES` length (`UNDOCUMENTED_BASELINE`) | 365 | **365** (held — every minted code got a real anchor) |
| `FIXTURES_RAISING_UNKNOWN` | 0 entries | table deleted |
| `COVERED_ELSEWHERE` | — | **−1** (`loom.duplicate-theme-block` promoted to a real fixture) |
| `FIRING_FIXTURES` | — | **+106** |
| `UNREACHABLE_PINS` | — | **+2** |

No emitter was touched, so the byte-identical corpus check does not apply to
this packet: the whole diff is `src/language/validators/**`,
`src/language/ddd-validator.ts`, `src/diagnostics/**`, `test/system/diagnostic-*`
and docs.

---

## 8. Open-PR overlaps (cited, not duplicated)

Read before touching the fence (`list_pull_requests`, state open, drafts
included).

| PR | overlap | how it was handled |
|---|---|---|
| **#2871** page-gate diagnostics | touches `src/diagnostics/{messages,code-docs}.ts` and `test/system/diagnostic-firing-census.test.ts` — the same three shared files this packet edits most | every edit here is an ADDITION in its own block, none of them near #2871's hunks (which are in `src/ir/validate/checks/ui-*`, a layer this packet does not touch). Textual conflicts on the fold, if any, are additive-only. |
| **#2874** read-path validators | touches `src/language/validators/repository.ts` | this packet's only hunk there is inside `checkGateIsBool` (the `requires`-must-be-bool site); #2874's are the file header and `checkRepositoryFinds`. Disjoint. |
| **#2949** `loom.unknown-primitive-member` | mints a code in the same catalog | no name collision with any of the 108 minted here; its code will need its own anchor + fixture as usual. |
| **#2942** page emitter fails open, **#2945** `currentUser` in criteria, **#2983 / #2981 / #2966 / #2947** codegen fixes with validator arms | each may add a validator `accept` | **all of them now land under an ABSOLUTE gate**: an uncoded `accept` in any of them fails invariant 5 rather than being absorbed by a baseline row. Flagged for the coordinator in §9. |
| **#2982** `id` as a parameter name | GRAMMAR change (4d's fence) | untouched. |

Concurrency, as briefed: no edit outside `test/system/diagnostic-*`,
`src/language/validators/**`, `src/language/ddd-validator.ts`,
`src/diagnostics/**` and docs. `test/language/validation/**` was **not** edited
— the per-condition proofs live in `FIRING_FIXTURES`, which is where the census
requires them and where 4b was told not to go.

---

## 9. Handed off — not fixed here

| item | why | what the owner / next packet needs |
|---|---|---|
| **`docs/new-plan/completion-waves-2026-09.md` rows 51 / 73 / 172 / 267** still say "~130" and describe 4c as pending | the plan file is the coordinator's, and 4a/4b/4d–4f all edit it | row 51's "current" column is now **0**; row 172 can be marked landed; row 267's `uncoded validator conditions` cell is **0**. Row 49/124's C1 note (flagged in the C1 hand-off and still open) can go at the same time. |
| **`docs/new-plan/waves/wave-c4.md` reconciliation table** row "uncoded validator sites (M-T9.56)" still reads 128 across 12 files | coordinator's log; three packets write to it | now **0**; the baseline file is deleted, so the "file" column has no target. |
| **The two UNREACHABLE arms** (§5) | deleting a defensive arm is an owner call, not a drain call | decide: keep pinned, or delete both arms + their catalog entries + their pins in one two-line change. |
| **Every open PR that adds a validator `accept`** (§8) | the gate is absolute from this branch's fold onward | a PR that adds an uncoded `accept` will now FAIL `tests passed` rather than silently growing a baseline row. That is the intent, but it is a behaviour change for six open PRs and the coordinator should expect one or two of them to need a code minted on rebase. The failure message tells the author exactly what to add. |

---

## 10. Files touched

```
 src/diagnostics/code-docs.ts                              (+108 anchors)
 src/diagnostics/messages.ts                               (+120 catalog keys)
 src/language/ddd-validator.ts                             (6 sites)
 src/language/validators/_shared.ts                        (1 site — the forwarding helper)
 src/language/validators/datasource.ts                     (9 sites)
 src/language/validators/deployable.ts                     (24 sites)
 src/language/validators/match.ts                          (12 sites)
 src/language/validators/repository.ts                     (1 site)
 src/language/validators/statements.ts                     (22 sites)
 src/language/validators/structural.ts                     (7 sites)
 src/language/validators/toplevel-function.ts              (1 site)
 src/language/validators/traceability.ts                   (9 sites)
 src/language/validators/types.ts                          (15 sites)
 src/language/validators/ui.ts                             (21 sites)
 test/system/diagnostic-catalog.test.ts                    (invariant 5 → absolute gate; scanner split)
 test/system/diagnostic-firing-census.test.ts              (+106 fixtures, +2 pins, waiver table deleted)
 test/system/diagnostic-firing-census.data.ts              (−1 COVERED_ELSEWHERE row)
 test/system/diagnostic-message-hygiene.test.ts            (+1 PROSE_SAYS_UNDEFINED row)
 test/system/diagnostic-uncoded-baseline.ts                (DELETED)
 docs/architecture/diagnostic-catalog.md                   (status blurb: convention → fact)
 docs/new-plan/T9-toolchain-health.md                      (M-T9.56 → done)
 docs/new-plan/README.md                                   (regenerated counts)
 docs/new-plan/waves/handoffs/wave-c4-4c-uncoded.md        (this note)
```
