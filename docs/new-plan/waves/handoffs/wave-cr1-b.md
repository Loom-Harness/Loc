# Wave CR1 — packet b (OIDC audience) hand-off

*Branch: `worktree-agent-a969add743a0d89c7`. Base: `main` @ `76ef74ad`.*
*Row: **P0-4** of [`../../../audits/code-review-2026-09-13.md`](../../../audits/code-review-2026-09-13.md).
Relinked at the fold — this was a plain reference on the packet branch, where the audit was not yet in
the tree and `test/system/archived-docs-fence.test.ts` correctly failed the dead link.*

> **This packet corrected the row it was draining.** The audit's table listed elixir as already
> env-overridable with a documented `OIDC_AUDIENCE=""` opt-out. It was not: every audience construct
> in `renderOidcVerifier` sits behind `auth.oidc.audience ? … : ""`, so an undeclared audience
> emitted no check at all — the same hole as node. The divergence was **two** backends, not one, and
> the audit's own table is now struck through and corrected in place.

## What landed

| # | item | state |
|---|---|---|
| 1 | hono gets the `OIDC_AUDIENCE` env fallback | **done** |
| 1b | **elixir had the same defect** — audit table was wrong; fixed | **done** (fence cited below) |
| 2 | `loom.auth-oidc-no-audience` warning | **done**, mutation-proved |
| 3 | audience row on the four `*-oidc-e2e` legs | **done** — shared probe, wired into all four, path filters updated |
| 4 | `docs/auth.md` + `docs/language-reference/17-auth.md` | **done** |

## Item 1 — the hono verifier, before and after

The `.ddd` (this is `test/e2e/fixtures/auth-oidc-e2e.ddd`, the shape the audit
describes — an `oidc` block with **no** `audience:`):

```ddd
auth {
  provider: keycloak
  oidc {
    issuer: env("OIDC_ISSUER")
    clientId: env("OIDC_CLIENT_ID")
  }
  claims: { roles: "realm_access.roles", email: "email" }
}
```

**Before** — `api/auth/oidc.ts`. No `AUDIENCE`, no env path, no `aud` term:

```ts
// Resolved from the system `auth { oidc { … } }` block.  Env-bound values
// read process.env at boot; an empty issuer fails loudly at first verify.
const ISSUER = process.env.OIDC_ISSUER ?? "";
// …
const { payload } = await jwtVerify(token, await getJwks(), { issuer: ISSUER });
```

**After** — same `.ddd`, same file:

```ts
// Resolved from the system `auth { oidc { … } }` block.  Env-bound values
// read process.env at boot; an empty issuer fails loudly at first verify.
const ISSUER = process.env.OIDC_ISSUER ?? "";
const AUDIENCE = process.env.OIDC_AUDIENCE ?? "";

// `aud` is validated only when an audience is actually configured — an empty
// AUDIENCE (nothing declared and OIDC_AUDIENCE unset, or an explicit
// OIDC_AUDIENCE="") skips the check, which is the documented opt-out.  With one
// set, a token minted for a DIFFERENT client of the same issuer is rejected.
const VERIFY_OPTIONS = AUDIENCE ? { issuer: ISSUER, audience: AUDIENCE } : { issuer: ISSUER };
// …
const { payload } = await jwtVerify(token, await getJwks(), VERIFY_OPTIONS);
```

Emitter: `src/platform/hono/v4/auth-emit.ts` (`renderOidcVerifier`). `hono/v5`
shares it via `makeHonoPlatform`, so `platform: node` (v5, the default) and
`node@v4` both get it.

### Boot-read, not per-verify — and why

Read **once at module load**, alongside `ISSUER`. Matching the file's existing
shape mattered more than matching any single sibling backend, and node has no
reason to defer: `process.env` at module load in a generated Node service *is*
the deploy environment. The other four split for reasons that are theirs:
python (`_AUDIENCE` module constant) and dotnet (`static readonly`) are boot
reads too; java reads at processor construction; elixir alone reads per-verify,
and its comment says exactly why — a module attribute would freeze the
*compile-time* env into the release, which is a mix/release problem Node does
not have.

**Empty means "skip", preserving elixir's documented `OIDC_AUDIENCE=""` opt-out.**
`envOverridableExpr` already collapsed both cases, so the change is one line at
the emitter (the conditional around `audienceConst` is gone) plus the
`VERIFY_OPTIONS` const. A declared `audience:` emits byte-identically to before.

## Item 1b — elixir had the same defect (audit table corrected)

The audit's table credits elixir with "env-overridable, with an explicit
documented `OIDC_AUDIENCE=""` opt-out". **That is only true when the `.ddd`
declares an `audience:`.** With none, `renderOidcVerifier` emitted no
`audience/0`, no `aud_present?/1` and no `add_claim("aud", …)` at all —
measured, not inferred:

```
$ sed 's/audience: "vanilla-api"//' vanilla-auth-oidc.ddd > noaud.ddd
$ ddd generate system noaud.ddd -o gen-ex2
$ grep -n OIDC_AUDIENCE gen-ex2/phoenix_app/lib/phoenix_app_web/auth.ex
(nothing)
```

So before this packet the divergence was **two** backends, not one. Fixed the
same way: the three fragments are now emitted unconditionally and gated on the
*runtime* `audience()`, which `envOrDeclared("OIDC_AUDIENCE", undefined)` renders
as `System.get_env("OIDC_AUDIENCE", "")` — unset is still the no-check default,
so a stack that sets nothing is unchanged.

```elixir
# api_elixir_web/auth.ex — undeclared audience, AFTER
@doc false
def audience, do: System.get_env("OIDC_AUDIENCE", "")

defp aud_present?(claims) do
  case audience() do
    "" -> true
    _ -> Map.has_key?(claims, "aud")
  end
end
```

**Fence note.** The brief fenced me off "the other four backends' auth emitters
*unless you find a real defect there*". This is that defect, and it is the same
P0-4 row, so I took it. `src/generator/elixir/auth-emit.ts` is outside
[#2933](https://github.com/Loom-Harness/Loc/pull/2933)'s 2f tree (`src/ir/**` +
`src/generator/_*/**`); #2933's 2a (elixir) is merged. The unrelated pre-existing
`noUnusedVariables` warning at `auth-emit.ts:278` (`devClaimStringFields`) is
**left for CR1-c**, which folds last and sweeps the lint ratchet — it is not mine
and biome still exits 0.

## The five-backend audience table, after this packet

| backend | `audience:` declared | `audience:` undeclared | `OIDC_AUDIENCE=""` |
|---|---|---|---|
| node / hono | `process.env.OIDC_AUDIENCE ?? "<declared>"` | `process.env.OIDC_AUDIENCE ?? ""` ✅ *(was: nothing)* | skips the check ✅ |
| elixir | `System.get_env("OIDC_AUDIENCE", "<declared>")` | `System.get_env("OIDC_AUDIENCE", "")` ✅ *(was: nothing)* | skips the check ✅ |
| python | `os.environ.get(...)` / declared | `os.environ.get("OIDC_AUDIENCE")` | **rejects every token** ⚠︎ |
| java | `System.getenv(...)` / declared | `System.getenv("OIDC_AUDIENCE")` | **rejects every token** ⚠︎ |
| dotnet | `Environment.GetEnvironmentVariable(...)` / declared | `Environment.GetEnvironmentVariable("OIDC_AUDIENCE")` | **rejects every token** ⚠︎ |

All five now read `OIDC_AUDIENCE` in both columns — the P0-4 divergence is closed.
The residual `OIDC_AUDIENCE=""` divergence is a **new** finding; see "found but
not fixed" below. The docs state it rather than claiming a uniformity that does
not exist.

## Item 2 — the diagnostic

| | |
|---|---|
| code | `loom.auth-oidc-no-audience` |
| severity | **warning** |
| raised by | `src/language/validators/auth.ts` → `checkAuthBlock`, step 3b |
| message | `src/diagnostics/messages.ts`, keyed by the bare code (no `#slug` — one code, one message) |
| docs anchor | `src/diagnostics/code-docs.ts` → `17-auth.md#auth-----oidc-config` (documented, so **not** added to `diagnostic-docs-undocumented.ts`) |
| firing fixture | `test/system/diagnostic-firing-census.test.ts` → `FIRING_FIXTURES["loom.auth-oidc-no-audience"]` (`UNCOVERED` untouched, still at its baseline) |
| negative tests | `test/language/auth-block.test.ts` — fires with no `audience:`; silent with a literal **and** with `env("OIDC_AUDIENCE")` |

Warning, not error, deliberately: a single-client deployment is a legitimate
shape, and every backend can now be switched on with `OIDC_AUDIENCE` at deploy
time without editing the `.ddd`. What was not legitimate is the silence —
before this, `grep -r audience src/language/validators src/ir/validate
src/diagnostics/messages.ts` returned nothing. It stayed an **AST** check
(`src/language/validators/`) rather than moving to `src/ir/validate/checks/`:
it reads one AST node's own optional property and needs no cross-aggregate,
multi-file or enriched information, which is the only thing phase ⑦ buys.

### Mutation proof (file-copy revert, per experience_gathered.md §84)

`src/language/validators/auth.ts` copied to
`$SCRATCH/auth-validator.keep.ts`, the guard mutated to
`if (false && auth.oidc !== undefined && …)`, gates run, then restored with
`cp` — never `git checkout --`.

```
 × auth block — validation > warns when oidc declares no audience (the aud check is then skipped)
   AssertionError: expected [] to include 'loom.auth-oidc-no-audience'
     151|     expect(warningCodes).toContain("loom.auth-oidc-no-audience");

 × diagnostic firing census > every fixture raises the code it claims > loom.auth-oidc-no-audience fires
   AssertionError: loom.auth-oidc-no-audience did not come out of its own fixture.
     2379|         ).toContain(code);

 Tests  2 failed | 2 passed | 264 skipped
```

The two emitter gates were mutation-proved the same way:

| mutated | assertion that failed |
|---|---|
| `hono/v4/auth-emit.ts` — `audienceConst` back to a declared-only ternary (else `const AUDIENCE = "";`) | `reads OIDC_AUDIENCE even when the .ddd declares no audience:` — `AssertionError: expected '// Auto-generated.\nimport { createRe…' to contain 'const AUDIENCE = process.env.OIDC_AUD…'` |
| `elixir/auth-emit.ts` — `audienceFn` / `audiencePresence` back to declared-only | `reads OIDC_AUDIENCE even when the .ddd declares no audience:` — `AssertionError: expected '# Auto-generated.\ndefmodule ApiWeb.A…' to contain 'def audience, do: System.get_env("OID…'` |

The hono gate also asserts the const is *used*
(`not.toContain("jwtVerify(token, await getJwks(), { issuer: ISSUER })")`) — a
constant nothing reads would be the same silent non-enforcement in a new costume.

## Item 3 — the e2e audience row (landed on all four legs)

`test/e2e/support/audience-probe.ts` (new) — `expectAudienceEnforced({ start, token })`.

**Why a second process.** Env is fixed at boot, and the primary backend in each
leg *must* run with the check off (every other assertion in those suites needs
the seeded Keycloak token accepted). So the row boots ONE MORE instance of the
**same built artifact** on its own port with
`OIDC_AUDIENCE=loom-audience-that-no-token-carries`, and asserts the **same real
token** is now rejected. That is a differential, not a bare 401: the primary
answered 200 for that exact token a few assertions earlier.

`/health` is asserted first and is on every backend's bypass list, so a 401 from
`/api/auth/me` cannot be "the process never came up" — the failure mode that
would otherwise let this row pass while proving nothing.

Each leg's spawn was hoisted into a `startBackend(port, extraEnv)` closure; the
primary is now `startBackend(apiPort, {})`, byte-identical env otherwise. No new
build, no new image pull, no new workflow — one extra process per leg.

**Path filters updated.** `test/e2e/support/audience-probe.ts` was added to the
`paths:` list of all four `*-oidc-e2e` workflows, in **both** the `push: main`
and the `pull_request` block. Without that, a change to the shared probe fires
none of the legs it is the assertion for — the exact P0-3 shape CR1-a is
draining. Worth a look from CR1-a: `test/e2e/support/**` is shared by many legs
and nothing systematically maps a support file to its consumers.

**Runtime verification — and the row is mutation-proved too.** The hono leg was
run locally on this branch (`LOOM_AUTH_E2E=1`, real Keycloak 26 + postgres 18 in
docker, backend native under `tsx`):

```
GREEN  Test Files  1 passed (1) · Tests  1 passed (1) · Duration 107.96s
```

Then the emitter was mutated back to the old declared-only shape (file copy,
never `git checkout --`) and the SAME leg re-run against a real IdP:

```
 × the generated OIDC verifier validates a real Keycloak token + maps claims
   AssertionError: OIDC_AUDIENCE=loom-audience-that-no-token-carries did not
   reject a token minted for a different audience — the generated verifier is
   ignoring the variable.
     102|       `OIDC_AUDIENCE=${WRONG_AUDIENCE} did not reject a token minted f…
 Test Files  1 failed (1)
```

So this is not a row that merely passes: it is a row that would have caught
P0-4 at runtime. The other three legs need the .NET SDK / a JDK+gradle / `uv`
and were not booted here — their backends already read `OIDC_AUDIENCE` on
`main`, so the row is a parity assertion there rather than a regression proof.

## Item 4 — docs

- `docs/auth.md` gains **"Token audience (`aud`)"** before "Auth routes": the
  resolution table (declared / `env(...)` / undeclared), the `.ddd` + generated
  node and python examples, the diagnostic, and a blockquote stating the
  `OIDC_AUDIENCE=""` divergence rather than papering over it. There was no
  audience prose in that file at all before — `grep -n audience docs/auth.md`
  returned nothing.
- `docs/language-reference/17-auth.md` — an `audience:` bullet under
  "`auth { … }` — OIDC config" (the anchor `code-docs.ts` now points the
  Problems panel at) and a row in the chapter's Errors table.

## Found but NOT fixed — for whoever takes the next auth packet

1. **`OIDC_AUDIENCE=""` is an opt-out on only two of five backends.** node and
   elixir treat an empty audience as "skip"; dotnet, java and python treat it as
   a *declared* audience of `""`, which no real token carries, so the stack
   rejects everything. The one-line fix per backend is to normalise empty to
   unset at the read:
   - dotnet `src/generator/dotnet/auth-emit.ts:164` — wrap the expression so
     `Audience` is `null` when the variable is empty (`ValidateAudience =
     Audience is not null` then does the right thing unchanged).
   - java `src/generator/java/emit/auth.ts:682` — same, `AUDIENCE` → `null`
     when blank, before `new DefaultJWTClaimsVerifier<>(AUDIENCE, …)`.
   - python `src/generator/python/auth-emit.ts:594` — `os.environ.get(...) or None`.
   Out of this packet's fence (three other backends' auth emitters, and a
   divergence distinct from the P0-4 row). Small, mechanical, and each one has
   an obvious unit assertion.
2. **`src/generator/elixir/auth-emit.ts:278`** — pre-existing unused
   `devClaimStringFields`, a `noUnusedVariables` warning. Left for **CR1-c**'s
   lint ratchet by design; flagged so it is not read as mine.
3. **`test/e2e/support/**` has no path-filter coverage rule.** Fixed by hand for
   the one file this packet added; the general gap belongs with CR1-a's
   `workflow-path-coverage.test.ts` work.
4. **Watch the first CI run of the three legs I could not boot.** The probe's
   second instance shares the leg's postgres, so it re-runs whatever the
   generated app does at startup (Flyway / EF `__EFMigrationsHistory` /
   SQLAlchemy create-all). All three are idempotent and the primary has already
   migrated by then, so this should be a no-op — but it is the one thing about
   the row that is asserted rather than measured on dotnet/java/python. The
   hono leg was measured, green and red-on-mutation. If one of the three trips,
   the cheapest fix is to give the probe instance its own database name rather
   than to drop the row.
5. **The elixir compose leg (`elixir-oidc-e2e`) has no audience row.** It is not
   one of "the four" the brief named, and its fixture
   (`vanilla-auth-oidc.ddd`) already declares `audience: "vanilla-api"`, so the
   elixir emitter change is byte-identical there and the leg's existing
   `src/generator/elixir/**` trigger covers it. An undeclared-audience elixir
   runtime row would be a genuine addition, just not this packet's.

## Gates run

| gate | result |
|---|---|
| `npx tsc -b` | clean |
| `npm run lint` (`biome ci .`) | exit 0; 24 warnings, all pre-existing (25 → 24 after I dropped a now-unused param; **no new warning from this packet**) |
| `npx vitest run test/system` | **98 files passed** / 1 skipped · 2151 tests passed / 30 skipped |
| `npx vitest run test/language test/generator/typescript` | **281 files passed** · 2548 tests passed / 2 skipped |
| `npx vitest run test/ir` | **270 files passed** · 3180 tests passed / 1 skipped |
| `npx vitest run test/generator/elixir/auth-oidc-emit.test.ts` | 19 passed |
| `npx vitest run test/language/auth-block.test.ts` | 14 passed |
| `LOOM_AUTH_E2E=1 npx vitest run test/e2e/auth-oidc-e2e.test.ts` (real docker Keycloak) | 1 passed |
| caught by a gate, fixed here | `test/system/archived-docs-fence.test.ts` — the hand-off's link to `docs/audits/code-review-2026-09-13.md` was dead in THIS tree (the audit lands with #2938): *"dead link into the frozen archive"*. Now a plain reference with a note to relink at the fold |
| mutation proofs | **4** — validator (×2 gates), hono emitter unit, elixir emitter unit, and the hono **runtime** e2e row; each failing assertion quoted above |

> **Runner note.** The box was saturated by a sibling agent's session (load avg
> ~57) and every `test/system` run under vitest's default forks pool was
> SIGKILLed mid-run with an empty log. `--pool=threads --no-file-parallelism`
> survives it. Worth knowing before reading an empty vitest log as a hang.

## Files touched

```
src/platform/hono/v4/auth-emit.ts          emitter — always-on OIDC_AUDIENCE + VERIFY_OPTIONS
src/generator/elixir/auth-emit.ts          emitter — audience()/aud_present?/add_claim("aud") unconditional
src/language/validators/auth.ts            new warning (step 3b)
src/diagnostics/messages.ts                message for loom.auth-oidc-no-audience
src/diagnostics/code-docs.ts               its language-reference anchor
docs/auth.md                               new "Token audience (aud)" section
docs/language-reference/17-auth.md         audience bullet + errors row
test/e2e/support/audience-probe.ts         NEW — the shared enforcement probe
test/e2e/auth-oidc-e2e.test.ts             hono audience row + hoisted startBackend
test/e2e/auth-oidc-dotnet-e2e.test.ts      idem
test/e2e/auth-oidc-java-e2e.test.ts        idem
test/e2e/auth-oidc-python-e2e.test.ts      idem
test/generator/typescript/auth-oidc-codegen.test.ts   hono emitter gate
test/generator/elixir/auth-oidc-emit.test.ts          elixir emitter gates (×2)
test/language/auth-block.test.ts                      validator gates (×2) + warning-aware helper
test/system/diagnostic-firing-census.test.ts          firing fixture
.github/workflows/{hono,python,java,dotnet}-oidc-e2e.yml   probe added to both paths: blocks
```
