# Wave C0 — packet 0.2(b) hand-off: Frontend full-stack e2e (nightly, #2636)

*Branch `claude/c0-frontend-fullstack` (3 commits), folded 2026-09-10. Seven files, all harness; no generator change was needed.*

## Root causes, from the failing runs' job logs (09-06 → 09-10)

| night | failing cells | cause |
|---|---|---|
| 09-10 | feliz | A |
| 09-09 | vue, svelte, feliz | B, B, A |
| 09-08 / 09-07 | feliz | A |

**Cause A — the feliz cell, every night: a real generated-app defect, already fixed on `main`.** `POST /api/products` → 422 (`{"pointer":"/price/amount","message":"Invalid input: expected number, received string"}`), so the create never redirected and the round-trip died 30 s later at `getByTestId("products-detail").waitFor()`. The Feliz wire encoder shared one arm between `money` (wire string) and `decimal` (wire number). Fixed by **#2674** (merged 15:12Z, 5½ h after the last red nightly — which is why #2636 still reads 0/20). Verified 10/10 green on fresh `main`; the defect re-seeded into `feliz/wire.ts` reproduces the CI failure exactly (rc=1, same locator, same 30 s timeout).

**Cause B — npm's optional-dependency hole (npm/cli#4828), intermittent.** `npm install` exited 0 having silently skipped `@rolldown/binding-linux-x64-gnu` (vite 8's bundler); `npm run build` then died with `Cannot find native binding`. Nothing about the generated code was wrong.

Not a cause: timeouts (the job runs in ~3 min), selectors, Node pins.

## Row table

| row | disposition | mutation proof |
|---|---|---|
| feliz 422 | fixed upstream (#2674), verified | seeded back → rc=1; file-copy revert → green |
| npm optional-dep hole | harness: `buildFrontend()` in `ui-stack.mjs` does one signature-keyed, loud, bounded heal (wipe `node_modules` + lockfile, reinstall once); installs carry `--fetch-retries=5` | `test/harness/ui-stack-frontend-build.test.ts`: heal removed → 2/6 fail; signature guard dropped → "a generated-code failure must not be papered over by a reinstall" |
| cause invisible in the log (§111) | harness: the emitted fixture records method+path+status+**body** of every non-OK response and `requestfailed`, appended to the thrown error; `run-ui.mjs` summary 4 → 24 lines | the seeded 422 now prints `[http 422] POST /api/products → {…}` instead of `Test timeout of 30000ms exceeded.` |
| a red cell left no artifacts | harness + workflow: `preserveArtifacts()` copies `test-results/` out of the mkdtemp before `finally` unlinks it; uploaded `if: failure()` with `include-hidden-files: true` (`.work-ui` is a dot dir — the repo's own `workflow-artifact-uploads.test.ts` caught the first version) | gated against a real temp tree |
| `execFileSync` dropped stdout | fixed — `combinedOutput()`; npm writes half its diagnosis to stdout | unit-asserted |
| `run-ui-flutter.mjs` | no change — already surfaces page errors + non-2xx statuses | |

## Gates

Leg 15/15 green over three consecutive full rounds of all five cells (+ a fourth on the rebased tree = 20/20), with Node 22.23.2, .NET 8.0.404, Flutter 3.47.3 installed locally. `tsc -b`, lint, typecheck ratchet, `test/system` 90 files, `test/harness` (10), frontend generator suites (274 files / 1949) green. `test/fixtures/baseline-output/web_app/e2e/fixtures.ts` regenerated (the emitter changed; `page-emitter-equivalence.test.ts` byte-diffs it).

## Notes for the coordinator

`test/harness/ui-stack-frontend-build.test.ts` is outside the literal fence (kept: it is the mutation-proof vehicle and follows the `behavioral-proc.test.ts` precedent). The angular cell fails on stock sandbox Node 22.22.2 (Angular CLI floor 22.22.3); CI's floating `'22'` resolves above it — the leg silently depends on that. Missions affected: M-T9.14, M-T9.15, M-T9.38. #2636 should close itself once the leg re-enters budget. Two gotchas worth harvesting: the §111 instance, and "a dot-dir upload ships nothing".
