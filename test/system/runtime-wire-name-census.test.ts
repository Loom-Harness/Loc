// Gate for D-NO-TOOL-NAME (docs/decisions).
//
// The HTTP headers, routes and environment variables generated deployables
// share across a boundary (a header a frontend sends and a backend reads, a
// variable compose sets and a backend reads) are spelled once, in
// `src/util/runtime-wire-names.ts`.  A name spelled out anywhere else in
// `src/` or the playground (`web/src/`) is a second source of truth: the next
// rename misses it, and the two sides of the boundary disagree.  This scans
// for a spelled-out name — the current one or the tool-named one it replaced —
// outside that module.  A TypeScript comment line is prose and is skipped.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { RUNTIME_ENV, RUNTIME_HEADERS, RUNTIME_ROUTES } from "../../src/util/runtime-wire-names.js";
import { expectReach } from "../_helpers/census-reach.js";
import { REPO_ROOT } from "../_helpers/ddd-corpus.js";

const SHARED_SOURCE = "src/util/runtime-wire-names.ts";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Generated identifiers spelled like a variable that name something else. */
const NOT_A_NAME: readonly { file: string; text: string; why: string }[] = [
  ...[
    "src/generator/java/emit/auth.ts",
    "src/generator/java/emit/security-headers-filter.ts",
    "src/generator/python/auth-emit.ts",
    "src/generator/python/security-headers.ts",
    "src/platform/hono/shared/auth-emit.ts",
  ].map((file) => ({
    file,
    text: "SECURE_TRANSPORT",
    why: "the generated constant holding the parsed value of the variable",
  })),
];

const SPELLED = new RegExp(
  [
    // headers and their FastAPI parameter spelling
    ...Object.values(RUNTIME_HEADERS).flatMap((h) => [h, h.replaceAll("-", "_")]),
    ...Object.values(RUNTIME_ROUTES),
    ...Object.values(RUNTIME_ENV),
  ]
    .map((n) => `(?<![A-Za-z0-9_$-])${escapeRe(n)}(?![A-Za-z0-9_-])`)
    // a channel's broker URL variable, and the tool-named spellings replaced
    .concat([
      "(?<![A-Za-z0-9_$])CHANNEL_[A-Z0-9_]+_URL(?![A-Za-z0-9_])",
      "x[-_]loom[-_](?:test[-_]reset|dev-claims|attempts|cache)",
      "/__loom/test-reset",
      "LOOM_(?:TEST_RESET|SECURE_TRANSPORT|OPENAPI_UI|DEV_AUTH|SEED|PG_URL|CHANNEL_|OUTBOX_RETENTION_DAYS)",
    ])
    .join("|"),
  "g",
);

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "generated") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...sourceFiles(p));
    else if (/\.tsx?$/.test(e.name)) out.push(p);
  }
  return out;
}

function isCommentLine(line: string): boolean {
  return /^\s*(\/\/|\*|\/\*)/.test(line);
}

function spelledOutSites(files: readonly string[]): string[] {
  const out: string[] = [];
  for (const abs of files) {
    const file = relative(REPO_ROOT, abs).replaceAll("\\", "/");
    if (file === SHARED_SOURCE) continue;
    readFileSync(abs, "utf8")
      .split("\n")
      .forEach((line, i) => {
        if (isCommentLine(line)) return;
        for (const m of line.matchAll(SPELLED)) {
          if (NOT_A_NAME.some((w) => w.file === file && w.text === m[0])) continue;
          out.push(`${file}:${i + 1}  ${m[0]}  ${line.trim().slice(0, 120)}`);
        }
      });
  }
  return out;
}

describe("runtime headers, routes and environment variables are spelled once", () => {
  const files = [
    ...sourceFiles(join(REPO_ROOT, "src")),
    ...sourceFiles(join(REPO_ROOT, "web/src")),
  ];

  it("no header, route or variable is spelled out outside src/util/runtime-wire-names.ts", () => {
    expect(
      spelledOutSites(files),
      `read the name from ${SHARED_SOURCE} (RUNTIME_HEADERS / RUNTIME_ROUTES / RUNTIME_ENV / channelUrlEnv)`,
    ).toEqual([]);
  });

  it("each NOT_A_NAME row still matches a line (a stale row fails)", () => {
    for (const w of NOT_A_NAME)
      expect(
        readFileSync(join(REPO_ROOT, w.file), "utf8").includes(w.text),
        `${w.file}: ${w.text}`,
      ).toBe(true);
  });

  it("the scan reaches src/ and the playground (denominator)", () => {
    expectReach("src/ and web/src/ TypeScript files scanned", files.length, 700);
  });
});
