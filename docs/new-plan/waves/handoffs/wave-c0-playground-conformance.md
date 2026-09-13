# Wave C0 — packet 0.2(c+d) hand-off: Playground e2e (#2844) and Conformance full (nightly)

*Branch `claude/c0-playground-conformance` (`1a03064`, `7c96762`), folded 2026-09-10. Neither leg was flaky: two specs that had never passed plus one real playground defect, and a build break that a vacuous docker-skip had hidden for a week.*

## Leg (c) — Playground e2e

**Root cause 1 (real playground defect).** `runtime.spec` › "Requests view counts the GET /products calls": the Requests view always rendered its empty state because the console tee never structured a line. The playground bundles the generated backend for a worker, so pino resolves its `browser` entry (`pino@9.14.0/browser.js`): top-level `formatters` are ignored (only `browser.formatters` apply), so the object reaches `console.info` with no `level`; and `prependBindingsInArguments` passes a child logger's bindings as a **separate argument** — `console.info({request_id}, {event:"request_end", …})`. `console-tee.ts` required `args.length === 1` with a level label → `structured: undefined` → `requestFromLogLine` null → total 0. Fixed with `structuredFromConsoleArgs(args, method)` (`web/src/util/log-line.ts`). Two more in the same path: `isInfraPath` matched `/auth/me` but auth mounts at `/api/auth` (`route-match.ts`); the spec's row filter required whitespace the DOM never has. The pre-existing `console-tee.test.ts` passed on a hand-typed shape the browser build never produces (§59/§63).

**Root cause 2 (never-run spec).** `preview-select-mode`: the docked three-column shell sits below the generated Mantine AppShell's `sm` breakpoint, so the navbar is translated off-canvas; a translated element keeps a box, Playwright called it visible and clicked left of the iframe — into the Monaco editor. And the spec armed select mode *before* navigating, while an armed click is `preventDefault()`ed (`iframe-html.ts:285`). Now: maximise → navigate → dock → arm → pick, with a burger fallback and a console/pageerror dump on failure (rule 17).

## Leg (d) — Conformance full (nightly)

All four reds were one failure, upstream of the backends the gate compares:
```
#109 [console_web build 8/8] RUN npm run build
src/lib/initials.ts(3,35): error TS2307: Cannot find module '../helpers'
```
The frontend `extern` hatch splits ownership — Loom writes the shim, the user writes the module — but `generate system` writes a whole tree and nothing else, so `examples/showcase.ddd`'s `function initials … extern from "./helpers"` yields a `console_web` that cannot `tsc`. Reproduced on fresh `main` (exit 2 → exit 0 with the harness fixture `test/e2e/support/extern-user-modules.ts`). **Why it was green before 09-07:** `describe.skipIf(!RUN)` plus a 5 s `docker info` probe read a loaded runner as "no docker" — runs 33953650250 and 34020901813 are five-minute greens with zero assertions. `LOOM_E2E=1` with no reachable daemon now **fails** (`LOOM_E2E_ALLOW_NO_DOCKER=1` to skip on purpose).

## Row table

| # | finding | disposition |
|---|---|---|
| c1 | pino-browser envelope defeats the console tee | fixed |
| c2 | `isInfraPath` misses `/api/auth/me` | fixed |
| c3 | Requests row filter anchored on absent whitespace | fixed (spec) |
| c4 | select-mode clicked an off-canvas navbar link | fixed (spec) |
| c5 | select-mode armed before navigating | fixed (spec) |
| c6 | no page-error surfacing on failure | fixed (spec) |
| **c7** | the generated backend's browser-mode log envelope itself is wrong (no `level`/`ts`, bindings split) | **handed off** — `browser: { asObject: true, formatters: { level } }` in `src/platform/hono/v4/observability-builder.ts`; drifts the baseline fixture (`scripts/capture-baseline-fixture.mjs`) |
| d1 | showcase's extern user module never written | harness fix |
| d2 | `LOOM_E2E=1` + no docker silently skipped | harness fix |
| d3 | remaining stack legs after `console_web` | unverified — sandbox containers have no egress |

Mutation proofs: the tee reverted to `args.length === 1` fails `console-tee.test.ts` and `route-match.test.ts` by name; `INFRA_PATHS` reverted fails "classifies the session probe at the path auth is actually mounted on"; d2 proven in all three env states; d1 on the real `tsc` command.

**Exit criterion not met, and stated:** the two heavy specs went green once each locally behind a since-reverted CDN shim (the sandbox browser has no CDN egress); repeat runs died in the in-browser npm install before any assertion these fixes touch. The 3-consecutive-green proof is CI's, on this wave PR.

Gates: `tsc -b` 0 · lint 0 · typecheck ratchet OK · `test/system` 90 files / 1924 · playground unit trio 33/33. Out-of-fence: `test/e2e/e2e.test.ts` + `test/e2e/support/extern-user-modules.ts` (the gate's own harness); item c7.
