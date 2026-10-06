// The java compile gate runs javac at maximum strictness — pinned.
//
// Every other backend's compile leg fails on a warning (`dotnet build
// /warnaserror`, `mix compile --warnings-as-errors`, `mypy --strict`, the
// generated project's own strict `tsc`).  Java reaches the same bar through a
// Gradle init script rather than through the emitted build.gradle.kts, so the
// gate is strict while a user's generated project is not forced onto -Werror.
// That indirection is also how it would be lost: the leg stays green, and
// stays listed, the day the install step or the script's flags go — and a
// lint class the emitters re-introduce then ships in silence.  So both halves
// are read here: the workflow installs the script before the gradle run, and
// the script turns every lint category on and every warning into an error.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const INIT_SCRIPT = "test/e2e/support/java-werror.init.gradle";

const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), "utf8");
const code = (src: string): string =>
  src
    .split("\n")
    .filter((l) => !/^\s*(#|\/\/)/.test(l))
    .join("\n");

describe("the java compile gate runs javac at -Xlint:all -Werror", () => {
  it("the init script applies both flags to every JavaCompile task", () => {
    const script = code(read(INIT_SCRIPT));
    expect(script).toMatch(/tasks\.withType\(JavaCompile\)/);
    expect(script).toContain("'-Xlint:all'");
    expect(script).toContain("'-Werror'");
  });

  // Both java compile legs: the fixture set and every corpus feature.
  const LEGS = [
    { workflow: "java-build.yml", run: "npm run test:java\n" },
    { workflow: "corpus-build.yml", run: "npm run test:java-corpus" },
  ] as const;

  it.each(LEGS)("$workflow installs it into ~/.gradle/init.d before the gradle run", (leg) => {
    const wf = code(read(`.github/workflows/${leg.workflow}`));
    const install = wf.indexOf(`${INIT_SCRIPT} ~/.gradle/init.d/`);
    const run = wf.indexOf(leg.run);
    expect(install, `${leg.workflow} no longer installs ${INIT_SCRIPT}`).toBeGreaterThan(-1);
    expect(run, `${leg.workflow} no longer runs ${leg.run.trim()}`).toBeGreaterThan(-1);
    expect(install, `the init script must be in place before ${leg.run.trim()}`).toBeLessThan(run);
  });

  it.each(LEGS)("$workflow re-runs when the init script changes", (leg) => {
    const wf = read(`.github/workflows/${leg.workflow}`);
    const pins = wf.split("\n").filter((l) => l.trim() === `- '${INIT_SCRIPT}'`);
    // One per path-filtered trigger (`push:` and `pull_request:`).
    expect(pins).toHaveLength(2);
  });
});

// The two java legs that run gradle themselves rather than through an
// installed init.d: the behavioural boot leg (the only java compile of the
// shared `systems/*.ddd` models) and the pairwise crossings (one container
// per fixture).  Each passes the script with `-I`, so it is read here too.
describe("the self-invoking java legs pass the same init script", () => {
  it("run-java.mjs adds `-I <init script>` to every gradle run", () => {
    const src = code(read("test/behavioral/run-java.mjs"));
    expect(src).toContain('join(REPO, "test", "e2e", "support", "java-werror.init.gradle")');
    const args = src.match(/const gradleArgs = \[([^\n]*)\];/);
    expect(args, "run-java.mjs no longer builds gradleArgs in one place").not.toBeNull();
    expect(args?.[1]).toContain('"-I", JAVA_WERROR_INIT');
  });

  it("pairwise-corpus-java mounts the script and passes `-I` to gradle", () => {
    const src = code(read("test/e2e/pairwise-corpus-java.test.ts"));
    expect(src).toContain('path.resolve(__dirname, "support", "java-werror.init.gradle")');
    expect(src).toContain("`${JAVA_WERROR_INIT}:/opt/loom/java-werror.init.gradle:ro`");
    const gradle = src.indexOf('"gradle",');
    const flag = src.indexOf('"/opt/loom/java-werror.init.gradle",');
    const task = src.indexOf('"testClasses",');
    expect(gradle).toBeGreaterThan(-1);
    expect(flag, "`-I` must be an argument of the gradle run").toBeGreaterThan(gradle);
    expect(flag).toBeLessThan(task);
  });

  it.each([
    { workflow: "behavioral-e2e-java.yml", pins: 2 }, // push: + pull_request:
    { workflow: "pairwise.yml", pins: 1 }, // one anchored path list
  ])("$workflow re-runs when the init script changes", ({ workflow, pins }) => {
    const wf = read(`.github/workflows/${workflow}`);
    expect(wf.split("\n").filter((l) => l.trim() === `- '${INIT_SCRIPT}'`)).toHaveLength(pins);
  });
});
