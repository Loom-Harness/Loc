# Wave C0 — packet 0.2(e) hand-off: the `behavioral-java` 20-minute cap

*Branch `claude/c0-behavioral-java`, folded 2026-09-10. Stacked on PR #2855 (a parallel session's measured timeout budgets for all seven behavioural legs — java 20 → 30 min, sizing rule `max(10, ceil5(p95 × 1.5))`, `ci-budget-report.mjs`, pinning test); this packet adds only the cost cut #2855 explicitly deferred.*

## The measurement #2855 already carried

13 cap kills in the last 100 runs (~18 %), java's p95 **censored** by its own cap, and the root cause named: `gradle --no-daemon bootJar` per corpus case, sequentially. The packet deleted its own weaker history table in favour of that.

## Root cause, opened up

The tier step is 93 % of the job and every one of the 53 cases costs 15.5–17.5 s with no outlier — a per-case constant, not a pathological fixture. `--no-daemon` does not even avoid the fork it names: the client JVM's heap does not meet the build requirement, so Gradle logs "a single-use Daemon process will be forked" and starts a throwaway daemon anyway, per case, paying a cold JVM + bootstrap + Kotlin-DSL classpath warm-up each time.

## Fix and before/after

`GRADLE_BASE = ["--daemon", "-q", "-Dorg.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=1g"]` in `test/behavioral/run-java.mjs`, plus `stopGradleDaemon()` at end of run.

```
--no-daemon   13.4 / 10.9 / 11.7 / 10.8 s   (mean 11.7 s)
daemon        10.5 /  3.1 /  2.8 /  2.6 s   (2.84 s steady state)
```

~4.1×, ~8.9 s off every case; same ratio under heavy load (36.3 s vs 10.6 s). Harness end-to-end on 6 cases: 5m16s → 3m07s CPU. Projection (stated as such in the workflow header): tier step 14m25s → ~6.5 min, job ~7.5 min against the 30-min cap. **The cap was not re-tightened** — #2855's rule wants a recorded p95 over ≥ 10 runs, and the post-fix sample does not exist yet.

Full 53-case leg with the fix: **104 passed, 0 failed, 12 skipped; wire differential 52 cases, 0 divergences** — byte-identical to CI run #2581 under `--no-daemon`. One daemon served all 53 projects; zero left after `stopGradleDaemon()`. Also fixed: the header said "JDK 21" while the generated `build.gradle.kts` pins a Java 25 toolchain.

## Gates

`tsc -b` 0 · lint 0 · `test/system` 90 files / 1924 · `timeout-budgets` + `golden-coverage` 17/17. Local wall time (35 min) is not comparable to CI — the box was shared with three other agents at load ~100; an earlier attempt at that load produced spurious `port 8125 never listened` and vitest-timeout errors that vanished at load ~10.

## Out of fence / next

1. Same pathology in `test/e2e/corpus-java-build.test.ts`, `generated-java-build.test.ts`, `pairwise-corpus-java.test.ts` (per-fixture `gradle --no-daemon` loops) — the same ~4× is available on the `java-corpus` and `generated-java-build` gates.
2. The remaining constant is boot-dominated (~4.5 s Spring Boot start per case); `-XX:TieredStopAtLevel=1` is the obvious next lever, not shipped unmeasured.
3. `proc.mjs` polls `waitForPort`/`waitForReady` at 300 ms (~16 s of pure wait per run, shared by six runners).
4. Re-derive java's budget with `node test/behavioral/ci-budget-report.mjs` once ≥ 10 post-fix runs exist; expect two or three steps down from 30.
