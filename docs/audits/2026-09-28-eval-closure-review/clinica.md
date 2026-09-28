# eval-clinica re-verification — main @ d2a0bc02 (2026-09-28)

Scope: `eval-clinica/FINDINGS.md` (disposition table of 2026-09-21 @62283b52), `FIX-PLAN.md`, `EVALUATION-REPORT.md`, `EVAL-LOG.md`, `evidence/*.md`.
Method: re-ran every repro in `eval-clinica/repro/` (via a copy of `tools/verify-repros.sh` pointed at scratch), per-backend where the finding is per-backend; grep of emitters/validators; ran the 4 pinning test files (24/24 pass); GitHub PR state for #2948/#2969/#2980/#3005.

| id | sev | register-status (09-21) | true-status (09-28) | evidence | notes |
|---|---|---|---|---|---|
| F-001 `--help` → docs/old | S3 | fixed #2998 | FIXED-VERIFIED | `ddd {,patch,trace,breakpoints} --help` cites only `docs/debugging.md` / `docs/api-toolkit.md`; commit b701df9ba + `test/cli/cli-tooling-truth.test.ts` | |
| F-002 repo read in invariant | S1 | fixed #2913 | FIXED-VERIFIED | r02 now `1 error(s)`: "This invariant references 'Appointments', which is a repository…" | verify-repros.sh still greps `appointment.ts` (now absent) — script stale |
| F-003 `duration` → NamedDecl | S3 | fixed #2998 | FIXED-VERIFIED | r01 → "Unknown type 'duration'. Field types are: …"; commit 5427af669, `unknown-type-message.test.ts` passes | repro file is `.ddd.txt`; `ddd parse` on it now dies with a raw Langium stack ("no services for the extension '.txt'") — register's repro command is unrunnable as written |
| F-004 `when fn()` private | S1 | fixed #2974 | FIXED-VERIFIED (5/5) | r06 on node/dotnet/java/python/elixir: `public bool IsOpen()`, `public boolean isOpen()`, `def is_open`, `def is_open(...)`; node grep `private isOpen` = 0 | |
| F-005 soft keyword `from` | S3 | fixed "this PR" | FIXED-VERIFIED | r04 → "'from' is a Loom keyword and cannot be READ as a name…"; "this PR" = #3005 (merged 09-22, commit 62dc0c6d8) | "this PR" should name #3005 |
| F-006 python crash half | S1 | fixed #2950 | FIXED-VERIFIED | r07 on python: `"on " + self._start_at.isoformat()` (no TypeError) | |
| F-006 format-drop | S2 | open, owned elsewhere ("recorded DELIBERATE in docs/new-plan/T1") | OPEN-UNTRACKED + WRONG-CLAIM | r07 node: `d1 = "on " + toISOString()`, `d5 = String(n)` (plural text lost), no diagnostic. The "deliberate" note is in `docs/new-plan/archive/T1-done.md:165` (closed-mission slice record: "format dropped", byte-identical) — an archive, not a live owner; no mission, no warning, `docs/language.md:1003` does not say backend `derived` ignores the format | nobody owns it |
| F-007 `create { }` remedy | S3 | fixed #2998 | FIXED-VERIFIED (wording half) | b82aed4fe: message + 06-behavior doc now say `create()`; `create-params-remedy.test.ts` | `create { }` still yields raw "Expecting token of type '('" — grammar asymmetry kept deliberately (recorded in ddd.langium) |
| F-008 retrieval no route | S2 | **open, unowned** | OPEN-TRACKED — WRONG-CLAIM | r08 routes still `"/" "/by_prac" "/{id}"` (by_prac = deprecated find). Tracked by **M-T5.31** (`docs/new-plan/T5-language-core.md:178`, `open`, L, P1, minted 2026-09-11 in 2d6dd6ee0 — existed before the 09-21 disposition) | register never cites M-T5.31 |
| F-009 `Repo.run(<Retrieval>)` paged crash | S2 | **fixed — "on main; no longer reproduces"** | OPEN-UNTRACKED — WRONG-CLAIM | r08b with `ListViaRetrieval` uncommented AND routed (`route GET "/via-ret" -> C.ListViaRetrieval`): `0 error(s)` then `Error: internal: paged queryHandler 'ListViaRetrieval' … Please file a bug.` on **all five** backends (node/dotnet/python/java/elixir). The 09-21 re-check only uncommented the handler; an un-routed handler is never emitted, so the crash path is not reached | no validator; not in M-T5.31 (which is about auto-routing a retrieval); grep of new-plan finds nothing |
| F-010 string→enum migration | S2 | fixed #2998 | FIXED-VERIFIED | 4f7621a5a; `test/system/migration-enum-value-set.test.ts` passes; migration-evolution e2e fixture extended | shared MigrationsIR → all backends |
| F-012 clobber on regenerate | S2 | claimed, open #2948 | WRONG-CLAIM (half fixed) + OPEN-UNTRACKED remainder | regenerate after hand edit now prints `Wrote 1 file(s) …, 1 of which had local modifications (pinnable via .loomignore)` (src/cli/main.ts:971, commit cf6b6afdf, reached main via **#2980** 09-22). Files are not named; structural half (pin freezes file, no merge/--diff) has no mission. #2948 is a draft, `mergeable_state: dirty`, untouched since 09-21 | claim ticket is stale |
| F-013 dotnet `state` | S1 | fixed #2923 | FIXED-VERIFIED | r14: `public sealed class __State`, `Order._Create(__State s)`; no `sealed class State` | |
| F-014 java Objects import | S1 | fixed #2925 | FIXED-VERIFIED | r15: `import java.util.Objects` count = 1 in `EmployeeResponse.java` | |
| F-015 elixir `__` vars | S3 | fixed #2911 | FIXED-VERIFIED | r13 elixir: no `__other/__dt/__s/__d` bindings in `lib/` | |
| F-016 workflow→private fn | S1 | fixed #2974 | FIXED-VERIFIED (5/5) | r16: dotnet `public bool HasSkill`, java `public boolean hasSkill`, python `def has_skill` called as `t.has_skill`, elixir `def has_skill`, node `private hasSkill` = 0 | |
| F-017 i18n locales never emitted | S2 | claimed, open #2969 | OPEN-TRACKED (weakly) | `i18n extract` + `i18n init de` + `generate system` → only `locales/en.json` emitted. #2969 is a draft, `dirty`, last update 09-21, no mission in docs/new-plan | claim is effectively abandoned; follow-up for HEEx/Feliz/Flutter explicitly out of #2969's scope and has no mission |
| F-018 recursive containment RangeError | S2 | claimed, open #2980 | FIXED-VERIFIED — WRONG-CLAIM (stale) | #2980 merged 2026-09-22 (a14cde8d5); r18 → `loom.containment-cycle` "Cyclic containment in aggregate 'Tree': Node → Node…"; `containment-cycle.test.ts` passes | |
| F-019 `…Exception` CA1711 | S3 | fixed #2950 | FIXED-VERIFIED | `test/generator/dotnet/legal-model-did-not-compile.test.ts:56` passes | |
| F-020 aud — generated comment | S2 | fixed #2950 | FIXED-VERIFIED on node; PARTIAL elsewhere | node oidc.ts (no `audience:`): "validates signature (JWKS) and issuer … The `aud` claim is NOT verified". .NET generated verifier still says "checks iss / aud / exp" unconditionally (check is gated on `OIDC_AUDIENCE` env) | .NET/python fall back to `OIDC_AUDIENCE` env; node/java/elixir do not — cross-backend divergence, and `docs/auth.md:1130` ("absence turns the aud check off") is inaccurate for .NET/python |
| F-020 aud — docs | S2 | fixed #2998 | FIXED-VERIFIED | `docs/auth.md:1130-1133`, `17-auth.md` | |
| F-020 aud — default off (the security finding itself) | S2 | not in disposition | OPEN-UNTRACKED | no `loom.auth-audience-unset`, no default to `clientId`; no mission in `docs/new-plan/T3` | documented, not adjudicated |
| F-020 sub: 403 echoes gate predicate | — | adjacent obs. (FIX-PLAN RC-10) | OPEN-UNTRACKED | `routes-builder.ts:1720/1746`, `workflow-builder.ts:2075/2122`: `ForbiddenError(\`Forbidden: ${g.source}\`)`; docs/auth.md shows it as normal output; no prod-suppress flag, no mission | low severity info-disclosure |
| F-020 sub: realm has no claim mappers | — | adjacent obs. | FIXED-VERIFIED | `src/system/index.ts:1062-1080` derives `oidc-usermodel-attribute-mapper` per `sys.user.fields` (727a510af, c972bd956/#3027) | |
| F-022 Angular `string[]` form | S1 | fixed "landed on main" | FIXED-VERIFIED | r22: `skills: new FormControl<string[]>([], { nonNullable: true })` + disabled "(arrays not yet supported in forms)" input | no PR cited |
| F-023 README dead links | S3 | fixed #2911 | FIXED-VERIFIED | README.md:18/54/231 → `loom-harness.github.io/Loc` | |
| F-024 .NET transactional buffer | S1 | fixed #2950 | FIXED-VERIFIED | r24 FinishDocHandler.cs: `var _workflowEvents` line 29 before `try` line 31; test `legal-model-did-not-compile.test.ts:81` | |
| F-011, F-021 | n/a | positives | n/a | — | |

## Register-level problems

- **Header tally wrong** (FINDINGS.md:7-17, also FIX-PLAN.md:3-4 and EVALUATION-REPORT §tally 235-246): severity table says 7 S1 / 8 S2 / 6 S3 = 21; body headings give **8 S1** (F-002,004,006,013,014,016,022,024) / **7 S2** (008,009,010,012,017,018,020) / **7 S3** (001,003,005,007,015,019,023) = 22. Class table says 14 SILENT / 4 HONEST / 3 other = 21; body gives **16 SILENT** / 4 HONEST / 2 docs-contradicted = 22. The 09-21 commit fixed "24 entries / 22 defects" but not the sub-tables.
- **Disposition prose** "17 of 22 closed; remaining F-008 + F-012/017/018" — today: 17 closed (F-018 in, F-009 out), F-006 and F-012 half-closed, open F-008 (M-T5.31), F-009 (untracked), F-017 (stale draft).
- `tools/verify-repros.sh` "all nine reproduce" (bcd25e3e) is stale; F-002 line greps a file that no longer exists; it `cd`s relative to its own path so it can't be copied.
- `repro/*.ddd.txt` (r01, r04): the register's `ddd parse …ddd.txt` commands crash with a raw Langium stack trace (unsupported extension) — a small untracked CLI diagnostic gap as well.
- FIX-PLAN wave 0 (P0 `corpus-compile-gate`, `test/system/generated-compiles.test.ts`, a Clinica corpus fixture) never landed and has no mission; fixes landed with per-finding unit tests instead.
- eval-clinica is not dispositioned in `docs/new-plan/coverage.md` (unlike the sibling eshop/freight/FieldOps audits) — so its open residue (F-006 drop, F-009, F-012 remainder, F-020 default, 403 echo) has no route into the plan.
- EVALUATION-REPORT.md / EVAL-LOG.md / evidence/*.md are dated snapshots (bcd25e3e, 2026-09-13); they carry no "superseded by FINDINGS disposition" pointer, so the report's "does not compile on three of five backends" headline now reads as current.

## Top problems

1. **F-009 marked fixed but still crashes all 5 backends** once the paged handler is routed (the only way it's reachable). Untracked.
2. **F-008 said "unowned"** while M-T5.31 (open, P1) has owned it since 09-11.
3. **F-018 still listed "claimed, open"** — fixed by #2980 on 09-22.
4. **F-012 still listed "claimed, open #2948"** — the silent-clobber half landed via #2980; #2948 and #2969 are stale dirty drafts holding claims nobody is exercising.
5. **F-006 format-drop "owned elsewhere"** — only an archive note; no owner, no warning; same for the **F-020 audience default** and the **403 predicate echo** — security items with no mission.
6. Tallies (FINDINGS/FIX-PLAN/REPORT) disagree with the body: real split 8/7/7, 16/4/2.
