// The flutter build gate fails on an analyzer WARNING, not only on an error —
// pinned.
//
// Every other compile leg treats a warning as an error (`dotnet build
// /warnaserror`, javac `-Xlint:all -Werror`, `mix compile
// --warnings-as-errors`, `mypy --strict`).  `flutter analyze` reaches the same
// bar by default and loses it to one flag, `--no-fatal-warnings`, which leaves
// the step green while it prints an unused import, a dead null check or an
// inference failure.  Infos stay non-fatal: they are style lints
// (prefer_const_*, string interpolation), the tier every toolchain leaves
// advisory.

import { readFileSync } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.resolve(here, "../../.github/workflows/generated-flutter-build.yml");

/** The workflow's executable lines — comments may mention the flag. */
const runLines = readFileSync(WORKFLOW, "utf8")
  .split("\n")
  .filter((l) => !/^\s*#/.test(l));

describe("generated-flutter-build fails flutter analyze on a warning", () => {
  const analyze = runLines.filter((l) => /\bflutter analyze\b/.test(l));

  it("analyzes every generated app it builds (vacuity guard)", () => {
    // showcase, scaffold parity, app shell.
    expect(analyze.length).toBeGreaterThanOrEqual(3);
  });

  it("no analyze step passes --no-fatal-warnings", () => {
    expect(analyze.filter((l) => l.includes("--no-fatal-warnings"))).toEqual([]);
  });

  it("every `flutter build web` app is analyzed first", () => {
    const builds = runLines.filter((l) => /\bflutter build web\b/.test(l));
    expect(builds.length).toBeGreaterThan(0);
    expect(analyze.length).toBeGreaterThanOrEqual(builds.length);
  });
});
