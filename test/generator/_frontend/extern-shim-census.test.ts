// Census: the machine-owned extern directory is spelled in one place.
//
// The web frontends write an extern component's re-export shim + typed props,
// and an extern function's conformance shim + signature, into a reserved
// `_extern` directory so they can never land on the user's own module (the
// documented `extern from "./components/<Name>"` names exactly the file a shim
// at the ordinary component path would overwrite).  Every such path, and every
// import of one, is built by `src/generator/_frontend/extern-shim.ts`; a
// frontend that spells the directory or hand-builds one of these paths itself
// drifts the moment the location moves, and puts the shim back on a path the
// user owns.
//
// This is a source-text census (what no compile or booted tier observes:
// where a path is spelled); the absence of a user-path write is asserted on
// the generated tree by `test/generator/_frontend/extern-user-path.test.ts`.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { expectReach } from "../../_helpers/census-reach.js";

const ROOTS = [
  "src/generator/react",
  "src/generator/vue",
  "src/generator/svelte",
  "src/generator/angular",
  "src/generator/_frontend",
];
const HELPER = "src/generator/_frontend/extern-shim.ts";

/** Each rule: a hand-built spelling of an extern shim location. */
const RULES: ReadonlyArray<{ what: string; re: RegExp }> = [
  { what: "the reserved `_extern` directory name", re: /_extern\b/ },
  { what: "a hand-built extern component props path", re: /\$\{[^}]*\}\.props\b/ },
  { what: "a hand-built extern function signature path", re: /\$\{[^}]*\}\.signature\b/ },
  { what: "a hand-built extern function shim path", re: /src\/lib\/\$\{/ },
  { what: "a hand-built extern function shim import", re: /lib\/\$\{(?:n|name|fn|fn\.name)\}/ },
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("extern shim census", () => {
  const files = ROOTS.flatMap(tsFiles).filter((f) => f !== HELPER);

  it("scans the web frontends", () => {
    expectReach("frontend generator source files", files.length, 120);
  });

  it("no frontend spells an extern shim location outside extern-shim.ts", () => {
    const hits: string[] = [];
    for (const file of files) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        for (const rule of RULES) {
          if (rule.re.test(line)) hits.push(`${file}:${i + 1} (${rule.what}): ${line.trim()}`);
        }
      });
    }
    expect(
      hits,
      "Build extern shim / contract paths and their imports through " +
        `${HELPER} instead:\n  ${hits.join("\n  ")}`,
    ).toEqual([]);
  });
});
