# Wave CR1 — packet c hand-off

*Branch: `worktree-agent-acb4378b61255bd8d`. Base: `origin/main` @ `76ef74ad`.
Commits: `47de8a44` (P1-3, deps) and `12b82bf7` (P1-5, lint). Not pushed; no PR.*

Rows: **P1-3** (dependency advisories) and **P1-5** (`biome ci` exits 0 on 24 warnings).

---

## Row P1-3 — dependency advisories

### What the `dependency-upgrade` skill classified this as

**Surface A only** (the toolchain's own deps). No Surface B (generated-project
stack/backend templates) involvement, so **no per-backend build gate and no
compose-boot gate is implicated by this diff** — which is the classification that
decides whether the heavy gates a narrow diff would skip need forcing. They do not.

Established, not assumed — `npm ls` / `npm explain` puts every finding on a
toolchain path:

| package | severity | reached via |
|---|---|---|
| `ip-address`, `qs`, `body-parser`, `fast-uri`, `hono`, `@hono/node-server` | high / mod / low | `packages/ddd-mcp` → `@modelcontextprotocol/sdk` → `express` / `express-rate-limit` |
| `nanoid`, `postcss` | high | `vitest` → `vite` (dev) |
| `vitest`, `@vitest/mocker`, `@vitest/coverage-v8` | moderate | direct devDependency |

**Surface B was checked and is genuinely not in play.** `ip-address` and `qs`
appear in **no** pin site: grepped `stacks/`, `designs/`, `packages/*/pins.ts`,
`src/platform/hono/v*/pins.ts`, `api/`, `vite/`, `docker/` — zero hits.

One trap worth naming, because the package list makes it look like Surface B: the
`hono` in `node_modules` is the **MCP SDK's transitive copy**, not the generated
Hono backend. That backend pins hono as an **emitted string** — `hono: "^4.12.0"`
in `src/platform/hono/v5/pins.ts` — which this diff does not touch and which
already admits the patched 4.13.5+. So generated projects pick the fix up on
their own next install; nothing to bump, no `hono-build` / `conformance-parity`
run to force.

### The advisory count had already moved

The audit row quotes **6** (1 low, 3 moderate, 2 high). On `main` @ `76ef74ad`
today it is **11** (1 low, 6 moderate, 4 high) — the DB picked up nine more,
including a 6-advisory `fast-uri` cluster and a 7-advisory `hono` cluster, since
2026-09-13. All 11 were in-range and Surface A, so one pass cleared everything.

### Before / after

```
before:  11 vulnerabilities (1 low, 6 moderate, 4 high)
after:   found 0 vulnerabilities
```

`npm ci` resolves clean (and ran the `prepare` lifecycle: `langium:generate` +
`build`, with no generated-file drift).

### Mechanism — and why it is not `npm audit fix`

**`npm audit fix` is unusable on this tree.** It crashes arborist:

```
npm error Cannot read properties of null (reading 'edgesOut')
    at #loadPeerSet (.../arborist/lib/arborist/build-ideal-tree.js:1289:38)
```

This is **pre-existing on pristine `main`**, not something this packet
introduced, and it reproduces on any command that re-resolves vitest. Chain:
`vite@8` → `@vitejs/devtools-vitest` → peer `vitest@*` → resolves to **vitest 5**
(an explicitly out-of-scope major) → its peer `@vitest/browser-playwright@5.0.0`
blows up `#loadPeerSet`. So the audit row's "`npm audit fix` reports a fix
available" is true of the *report* but not of the *command*.

Fix, in two parts:

1. **Eight transitive packages: lockfile-only.** Every fixed version sits inside
   the range its parent already declares (`ip-address` `^10.2.0` → 10.7.0;
   `qs` `^6.14.1` → 6.16.0; etc.), so `npm update <pkgs>` moved them with **no
   `package.json` change**.
2. **The vitest trio** needed 4.1.11, which `^4.1.9` already admitted — but the
   crash blocked getting there. Pinning the one offending nested peer unblocks
   arborist *and* lets the direct devDep move:

   ```json
   "overrides": {
     "hono": ">=4.12.26",
     "@vitejs/devtools-vitest": { "vitest": "^4.1.11" }
   }
   ```

   Two routes were tried and rejected first, recorded so nobody repeats them: a
   **top-level** `vitest` override is refused with `EOVERRIDE — Override for
   vitest@^4.1.9 conflicts with direct dependency`; and `$vitest` reference syntax
   gives `Unable to resolve reference $vitest` in a nested position, hence the
   literal range.

   **This override is temporary scaffolding.** It should be deleted the moment
   the repo moves to vitest 5, or when npm fixes the arborist bug. It exists only
   to stop `vitest@*` resolving across the major boundary.

Net diff: `package.json` +4/-2 lines, `package-lock.json` +258/-318.

### Pending majors — deliberately NOT done

Out of scope per the brief, each wants its own PR: **TypeScript 7**, **vitest 5**,
**langium 4.4**, **chalk 6**. (Note the tree is *already* on `typescript: ~6.0.0`
and `langium: ~4.3.0`.) vitest 5 is the one with a live hook into this packet —
it is what the new override exists to hold back, so whoever does that bump should
delete the override in the same PR.

---

## Row P1-5 — `biome ci` exits 0 on warnings

Verified on `main` @ `76ef74ad`: `npx biome ci .` → "Found 24 warnings", **exit 0**.

### (a) Auto-fix pass — 16 of 24 sites, all in-fence

Applied with `biome check --write --unsafe` scoped to the three rules
(`correctness/noUnusedImports`, `correctness/noUnusedVariables`,
`complexity/useOptionalChain`) and to an explicit file list, so nothing outside
the fence was touched.

**Three needed manual work.** Biome's unsafe fix for `noUnusedVariables`
**renames to `_foo`** rather than deleting, which only hides the warning, and it
will not touch an unused destructured binding at all:

- `src/generator/elixir/domain/predicates.ts` — `walkExpr` was a **dead
  hand-rolled one-level `switch (e.kind)` over `ExprIR`**. Wave-2 packet 2.3
  migrated its callers onto `walkExprDeep`, and the surviving doc comment already
  read "(`walkExpr` below, now deleted)" — but the 60-line body was still there.
  **Deleted for real** (and the comment corrected to "since deleted") instead of
  parked as `_walkExpr`: a dead hand-rolled IR walk is exactly the drift class
  CLAUDE.md's "No hand-rolled IR walks" rule and `ir-walk-census` exist to keep
  out, and leaving it renamed would have preserved the hazard while silencing the
  signal. **Checked against CR1-d's fence:** the function carries no
  `ir-walk-census` waiver (grepped), so nothing there goes stale.
- `src/generator/elixir/auth-emit.ts` — `devClaimStringFields` computed, never
  read. Deleted. (Note: this is `elixir/auth-emit.ts`, **not** CR1-b's
  `src/platform/hono/v4/auth-emit.ts`.)
- `test/generator/_packs/pack-spacing-contract.test.ts` — unused `pack` in a
  destructuring; `{ p, pack }` → `{ p }` by hand.

The two `useOptionalChain` rewrites are semantically identical
(`x && x.f(...)` → `x?.f(...)`, `!first || first.$type !== T` → `first?.$type !== T`
— in both, the null case lands on the same branch).

### (b) The ratchet, and why this mechanism

`"lint": "biome ci . --error-on-warnings"`.

**Chosen over promoting the rules to `error` in `biome.json`** because the
promote route has to **enumerate**, and an incomplete enumeration silently
re-opens the hole for the next rule — which is the very failure P1-5 describes.
The `recommended` preset ships its own severities and gains rules across Biome
minors; a rule landing at `warn` in a future `@biomejs/biome` 2.x would walk
straight past a hand-maintained error list, and nobody would notice, because the
symptom is a *green* build. The flag is total, lives in one place, and needs no
maintenance.

**The blunt-flag hazard the brief warns about was checked, not assumed.**
`biome.json`'s `files.includes` is an **allowlist**, not a denylist:
`src/**/*.ts`, `test/**/*.ts`, `scripts/**/*.mjs`, minus `src/language/generated`,
`test/fixtures`, `**/__snapshots__`, `**/*.d.ts`, `out`, `coverage`,
`node_modules` — plus `vcs.useIgnoreFile: true`. So no generated or vendored tree
can surface on the flip: **24 was the whole surface**, and the count is 24
everywhere.

**Both enforcement points already call `npm run lint`, so both inherit the flag
and neither needed editing** (checked, per the brief):
- `.github/workflows/test.yml:186` — `run: npm run lint`
- `.claude/hooks/biome-gate.sh` — `npm run --silent lint`

`.github/workflows/test.yml` was therefore **not modified**, which also keeps this
packet clear of CR1-a's `.github/workflows/**` fence.

### MUTATION PROOF

Run in a **scratch copy** of the tree, because the real worktree cannot reach a
clean state without touching #2933's files (and the harness correctly refuses
those writes). Reverted by **file copy**, never by restoring from HEAD
(`experience_gathered.md` §84).

Setup: scratch copy with the 8 out-of-fence sites fixed, so the tree is genuinely
clean. Then seed **one** unused import into `src/util/naming.ts`:

```
import { readFileSync } from "node:fs";
```

| run | output | exit |
|---|---|---|
| new script, **clean** tree | `Checked 3145 files in 11s. No fixes applied.` | **0** |
| **OLD** script `biome ci .`, seeded tree | `Found 1 warning.` | **0** ← the bug |
| **NEW** `biome ci . --error-on-warnings`, seeded tree | `Found 1 warning.` / `× Some warnings were emitted while running checks.` | **1** ← the ratchet |
| restore `naming.ts` by file copy | `Checked 3145 files in 5s.` | **0** |

The old-script row is the load-bearing one: same tree, same single warning, exit
**0** before and **1** after — so the flag, and only the flag, is what turns a
warning into a failure. Biome's own diagnostic quoted:

```
  ! This import is unused.

  > 1 │ import { readFileSync } from "node:fs";
      │        ^^^^^^^^^^^^^^^^

  i Unused imports might be the result of an incomplete refactoring.
```

---

## LEFT FOR THE COORDINATOR — 8 warning sites in another fence

**`npm run lint` is RED on this branch until these land**, by design: the fence
says leave them and list them, and adding a `biome-ignore` to dodge them was
explicitly out. All 8 sit in **PR #2933**'s fence (`src/ir/**`,
`src/generator/flutter/**`). None are CR1-a / CR1-b / CR1-d files — those packets
carry no Biome warnings at all.

| # | file | rule | line |
|---|---|---|---|
| 1 | `src/generator/flutter/index.ts` | `noUnusedImports` | 40 |
| 2 | `src/ir/types/loom-ir.ts` | `useOptionalChain` | 4137 |
| 3 | `src/ir/util/workflow-own-state.ts` | `useOptionalChain` | 123 |
| 4 | `src/ir/validate/checks/backend-syntax-checks.ts` | `useOptionalChain` | 123 |
| 5 | `src/ir/validate/checks/orm-adapter-checks.ts` | `noUnusedImports` | 20 |
| 6 | `src/ir/validate/checks/projection-backend-checks.ts` | `noUnusedImports` | 11 |
| 7 | `src/ir/validate/checks/ui-checks.ts` | `noUnusedVariables` (`MAP_UNRENDERED_FRAMEWORK`) | 361 |
| 8 | `src/ir/validate/checks/ui-collection-display-checks.ts` | `noUnusedImports` | 28–29 |

**These 8 are exactly sufficient** — measured, not estimated: fixing precisely
this list in the scratch copy took `biome ci . --error-on-warnings` to **exit 0**
over all 3145 files. Sweep them at fold with:

```bash
npx biome check --write --unsafe \
  --only=correctness/noUnusedImports \
  --only=correctness/noUnusedVariables \
  --only=complexity/useOptionalChain \
  src/generator/flutter/index.ts src/ir/types/loom-ir.ts \
  src/ir/util/workflow-own-state.ts \
  src/ir/validate/checks/backend-syntax-checks.ts \
  src/ir/validate/checks/orm-adapter-checks.ts \
  src/ir/validate/checks/projection-backend-checks.ts \
  src/ir/validate/checks/ui-checks.ts \
  src/ir/validate/checks/ui-collection-display-checks.ts
npm run lint   # must now exit 0
```

**Check #7 by hand after running that.** `MAP_UNRENDERED_FRAMEWORK` is an unused
*variable*, so Biome will rename it `_MAP_UNRENDERED_FRAMEWORK` rather than remove
it. Decide whether it is dead (delete) or a dropped reference (wire it up) — the
same call made for `walkExpr` above. A rename would satisfy the linter while
leaving the question open.

If #2933 merges first and happens to clear some of these, re-run `npm run lint`
and sweep only what remains.

---

## Gates run

| gate | result |
|---|---|
| `npx tsc -b` | clean (exit 0) |
| `npm run lint`, clean tree | **exit 0** (scratch-copy proof above) |
| `npm run lint`, seeded warning | **exit 1**, old script exit 0 (proof above) |
| `npm run lint`, this branch as it stands | exit 1 — the 8 out-of-fence sites above |
| `npx vitest run test/system test/platform` | 144 files, **2613 passed**, 30 skipped |
| `npx vitest run test/macro test/generator/{elixir,java,python,dotnet} test/language` | 734 files, **5375 passed**, 2 skipped |
| `npm audit` | **found 0 vulnerabilities** (was 11) |
| `npm ci` | resolves clean |

`test/system` covers the CI meta-tests the brief flagged — `local-run-mapping.test.ts`,
`pr-gate.test.ts`, `merge-queue-readiness.test.ts` — all green, so neither the
`lint` script change nor the dep bump broke the CI wiring assertions. The suite
reports `RUN v4.1.11`, confirming the vitest bump is live and the fast tier is
unaffected by it.
