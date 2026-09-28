#!/usr/bin/env node
// Typecheck gate for `test/`.
//
// `tsconfig.json` excludes `test/`, and nothing else covers it: `npm run build`
// compiles `src/**`, and `biome ci .` is a linter.  So none of the ~2,000 files
// under `test/` were typechecked by any gate — which meant a `Record<Union, …>`
// written in a test to prove exhaustiveness proved nothing, because no compiler
// ever read it.  Three separate packets tripped over that independently.
//
// HISTORY.  This landed as a shrink-only RATCHET, because a bare `--noEmit`
// step could not: there were 768 errors over 219 files, so adding one would
// have made every PR red.  `test-typecheck-baseline.json` pinned each file's
// count and the number could only go down.  M-T9.50 drained it to zero
// (wave C4, packet 4b), the baseline file is gone, and this is now what the
// ratchet existed to become: **any error fails**.
//
// SCOPE.  Two populations, both required to be clean:
//
//   - `test/**` — the point of the gate.
//   - `src/**`  — compiled by `npm run build` already, but the test project
//                 pulls it in under different options (module resolution, lib),
//                 so a regression could surface only here and would otherwise
//                 be blamed on a test file.  Reported separately for that
//                 reason.
//
// `web/**` is deliberately NOT in scope.  It is a separate package with its own
// `tsconfig.json` (`moduleResolution: Bundler`) and its own dependencies; the
// playground tests import from it, so its files land in this program, but
// compiling them under the toolchain's `Node16` settings reports hundreds of
// resolution artifacts that mean nothing.  `web`'s own `npx tsc -b` gates it
// (`test.yml`'s lint job runs it right after this step).
//
// What `tsconfig.test.json` excludes is documented there: in every case it is
// source this project does not compile, because the suite copies it into a
// GENERATED project that builds it with its own toolchain.
//
// Usage:  node scripts/test-typecheck.mjs

import { execFileSync } from "node:child_process";

const PROJECT = "tsconfig.test.json";

/** Errors from a real `tsc -p tsconfig.test.json --noEmit`, split by tree. */
function measure() {
  let output = "";
  try {
    execFileSync("npx", ["tsc", "-p", PROJECT, "--noEmit"], { encoding: "utf8" });
  } catch (err) {
    // tsc exits non-zero when it reports errors; that is the expected path.
    output = `${err.stdout ?? ""}${err.stderr ?? ""}`;
  }

  const testErrors = [];
  const srcErrors = [];
  for (const line of output.split("\n")) {
    if (/^test\/[^(]+\(\d+,\d+\): error TS\d+/.test(line)) testErrors.push(line);
    else if (/^src\/[^(]+\(\d+,\d+\): error TS\d+/.test(line)) srcErrors.push(line);
  }
  return { testErrors, srcErrors };
}

const { testErrors, srcErrors } = measure();
const failures = [];

const report = (label, lines) =>
  `${lines.length} error(s) under ${label}:\n${lines
    .slice(0, 25)
    .map((l) => `    ${l}`)
    .join("\n")}${lines.length > 25 ? `\n    … and ${lines.length - 25} more` : ""}`;

if (testErrors.length > 0) {
  failures.push(
    `${report("test/", testErrors)}\n\n  Fix the types, not the test.  The drain (M-T9.50) ` +
      `replaced the partial-object casts with typed fixture builders in\n  ` +
      `\`test/_helpers/ir-builders.ts\`, \`ast.ts\` and \`diagnostics.ts\` — reach for those ` +
      `before writing a new \`as unknown as X\`.`,
  );
}
if (srcErrors.length > 0) {
  failures.push(`${report("src/", srcErrors)}\n\n  src/ must stay clean in the test project too.`);
}

if (failures.length > 0) {
  console.error(`\ntest/ typecheck gate FAILED\n\n${failures.join("\n\n")}\n`);
  process.exit(1);
}
console.log("test/ typecheck gate OK — test/ and src/ are both clean under tsconfig.test.json.");
