// The schemathesis tool environment is resolved ONCE, under exact pins.
//
// schemathesis 4.24.3 declares only floors on the libraries its case generator
// calls (`jsonschema-rs >= 0.49`, `hypothesis >= 6.130`), so a fresh resolve
// floats them.  `jsonschema-rs` 0.60 drops `CanonicalSchema.is_satisfiable` and
// `hypothesis` 6.170 breaks a strategy combinator schemathesis uses; either one
// turns every parameterised operation into an `error:AttributeError` finding on
// all five legs.
//
// A second install step cannot repair that: `pipx inject <venv> <pkg>==<v>` is a
// no-op when `<pkg>` is already installed ("already seems to be installed …
// Pass '--force'"), and it exits 0.  So the pins live in one constraints file
// applied to the tool's own resolve, and this test holds the workflow and the
// documented local install to that shape.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..", "..");
const CONSTRAINTS = "test/behavioral/schemathesis-constraints.txt";
const read = (p: string): string => readFileSync(join(ROOT, p), "utf8");

/** `name==version` rows of the constraints file, comments dropped. */
function pins(): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of read(CONSTRAINTS).split("\n")) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const m = /^([A-Za-z0-9_.-]+)\s*==\s*([^\s;]+)$/.exec(line);
    expect(m, `${CONSTRAINTS}: "${line}" is not an exact \`name==version\` pin`).not.toBeNull();
    out.set(m![1]!.toLowerCase().replace(/_/g, "-"), m![2]!);
  }
  return out;
}

describe("schemathesis tool pins", () => {
  it("pins every library the case generator calls, exactly", () => {
    expect([...pins().keys()].sort()).toEqual(
      ["hypothesis", "hypothesis-jsonschema", "jsonschema-rs"].sort(),
    );
  });

  it("the workflow installs schemathesis under the constraints file, in one resolve", () => {
    const wf = read(".github/workflows/schemathesis.yml");
    const installs = wf.split("\n").filter((l) => /\b(pipx|uv tool|pip)\b.*\binstall\b/.test(l));
    expect(installs.length, "schemathesis.yml installs schemathesis").toBeGreaterThan(0);
    for (const l of installs) {
      expect(l, "every schemathesis install applies the constraints file").toContain(
        `-c ${CONSTRAINTS}`,
      );
    }
    expect(wf, "`pipx inject` of an installed package is a silent no-op").not.toMatch(
      /pipx\s+inject/,
    );
  });

  it("every documented local install names the same constraints file", () => {
    for (const p of [
      "docs/testing.md",
      "test/behavioral/README.md",
      "test/behavioral/schemathesis-core.mjs",
      ".github/workflows/schemathesis.yml",
    ]) {
      const lines = read(p)
        .split("\n")
        .filter((l) => /uv tool install schemathesis/.test(l));
      expect(lines.length, `${p} documents the local install`).toBeGreaterThan(0);
      for (const l of lines) expect(l, p).toContain(`-c ${CONSTRAINTS}`);
    }
  });
});
