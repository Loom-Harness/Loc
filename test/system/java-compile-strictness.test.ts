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
