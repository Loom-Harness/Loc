// The shared Gradle invocation for the java compile legs that run gradle ON THE
// HOST, back to back, once per fixture (`corpus-java-build`,
// `generated-java-build`).  Ported from `test/behavioral/run-java.mjs`, where
// wave C0 packet 0.2e measured it.
//
// `--no-daemon` does NOT avoid the fork its name promises.  The client JVM's
// heap does not meet the build requirement, so Gradle logs "a single-use Daemon
// process will be forked" and starts a throwaway daemon anyway — per fixture,
// paying a cold JVM + Gradle bootstrap + Kotlin-DSL build-script classpath
// warm-up every time.  Measured back to back on one generated project:
//
//     --no-daemon   13.4 / 10.9 / 11.7 / 10.8 s   (mean 11.7 s)
//     daemon        10.5 /  3.1 /  2.8 /  2.6 s   (2.84 s steady state)
//
// ~4.1x, and the same ratio held under heavy load (36.3 s vs 10.6 s).
//
// `--daemon` is Gradle's default, so it is passed explicitly only to defend
// against an ambient `GRADLE_OPTS=-Dorg.gradle.daemon=false`.  The heap /
// metaspace bump keeps ONE daemon serving every project in the leg instead of
// letting it expire and re-fork part-way through (each project loads its own
// compiled build-script classloaders, so metaspace is the binding constraint);
// the args must be IDENTICAL on every invocation or Gradle forks a second
// daemon for the differing JVM args.  `stopGradleDaemon()` reaps it at the end.
//
// Deliberately NOT used by `pairwise-corpus-java.test.ts`: that leg runs each
// fixture in its own `docker run --rm` container, so a daemon dies with the
// container it started in and there is nothing for the next fixture to reuse.

import { execFileSync } from "node:child_process";

/** The flags every host-side `gradle` invocation in these legs shares — one
 *  spelling, because a differing `-Dorg.gradle.jvmargs` forks a second daemon
 *  and gives the whole run back its cold-start cost. */
export const GRADLE_BASE = [
  "--daemon",
  "-q",
  "-Dorg.gradle.jvmargs=-Xmx2g -XX:MaxMetaspaceSize=1g",
] as const;

/** `gradle <GRADLE_BASE> <tasks…>` as one shell string, for `execSync`. */
export function gradleCmd(...tasks: readonly string[]): string {
  return ["gradle", ...GRADLE_BASE.map((a) => (a.includes(" ") ? `'${a}'` : a)), ...tasks].join(
    " ",
  );
}

/** Reap the daemon at the end of a leg so a local run leaves no JVM behind.
 *  `gradle --stop` stops every COMPATIBLE daemon, not only ours — the same
 *  thing CI's `setup-gradle` post-step does, and the reason not to run this
 *  tier alongside another Gradle build on one machine.  Never fatal: no daemon
 *  and no `gradle` on PATH are both nothing to clean up. */
export function stopGradleDaemon(): void {
  try {
    execFileSync("gradle", ["--stop"], { stdio: "pipe" });
  } catch {
    /* no daemon, or no gradle on PATH — nothing to reap */
  }
}
