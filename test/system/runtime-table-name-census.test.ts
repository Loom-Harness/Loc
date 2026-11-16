// Gate for D-NO-TOOL-NAME (docs/decisions).
//
// The runtime's own tables (outbox, inbox, timer claim, timer watermark,
// migration ledger, seed marker) are spelled once, in
// `src/util/runtime-tables.ts`, and every backend, the migration builder and
// the test-reset handler read them from there.  A table name spelled out
// anywhere else in `src/` is a second source of truth: the next rename misses
// it, and two backends sharing one database disagree on the table.  This scans
// `src/` for a spelled-out runtime table name outside that module.
//
// A line that is a TypeScript comment is prose about the table, not a
// spelling of it, and is skipped.  `NOT_A_TABLE` lists the generated
// identifiers that share a table's spelling but name something else.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { RUNTIME_TABLES } from "../../src/util/runtime-tables.js";
import { REPO_ROOT } from "../_helpers/ddd-corpus.js";

const SHARED_SOURCE = "src/util/runtime-tables.ts";

/** Generated identifiers spelled like a runtime table that are not one. */
const NOT_A_TABLE: readonly { file: string; text: string; why: string }[] = [
  {
    file: "src/generator/dotnet/workflow-emit.ts",
    text: "_inbox",
    why: "the C# field holding the injected IConsumerInbox (`_inbox = inbox`, `_inbox.ApplyOnceAsync`)",
  },
];

const NAMES = Object.values(RUNTIME_TABLES);
const SPELLED = new RegExp(
  // The reserved spelling (`_outbox`) and the tool-named one it replaced
  // (`__loom_outbox`, `loom_timer_runs`).
  `(?<![A-Za-z0-9_$])(?:__loom_|loom_(?=timer_runs)|_)(?:${NAMES.map((n) => n.slice(1)).join("|")})(?![A-Za-z0-9_])`,
  "g",
);

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

function isCommentLine(line: string): boolean {
  return /^\s*(\/\/|\*|\/\*)/.test(line);
}

/** `file:line  text` for every spelled-out runtime table name in `src/`. */
function spelledOutSites(files: readonly string[]): string[] {
  const out: string[] = [];
  for (const abs of files) {
    const file = relative(REPO_ROOT, abs).replaceAll("\\", "/");
    if (file === SHARED_SOURCE || file.startsWith("src/language/generated/")) continue;
    const lines = readFileSync(abs, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (isCommentLine(line)) return;
      for (const m of line.matchAll(SPELLED)) {
        const waived = NOT_A_TABLE.some((w) => w.file === file && w.text === m[0]);
        if (!waived) out.push(`${file}:${i + 1}  ${m[0]}  ${line.trim().slice(0, 120)}`);
      }
    });
  }
  return out;
}

describe("runtime table names are spelled once", () => {
  const files = tsFiles(join(REPO_ROOT, "src"));

  it("no runtime table name is spelled out in src/ outside src/util/runtime-tables.ts", () => {
    expect(
      spelledOutSites(files),
      `read the name from RUNTIME_TABLES (${SHARED_SOURCE}) instead of spelling it`,
    ).toEqual([]);
  });

  it("each NOT_A_TABLE row still matches a line (a stale row fails)", () => {
    for (const w of NOT_A_TABLE) {
      const text = readFileSync(join(REPO_ROOT, w.file), "utf8");
      expect(text.includes(w.text), `${w.file}: ${w.text}`).toBe(true);
    }
  });

  it("the scan reaches the emitters (denominator)", () => {
    expect(files.length).toBeGreaterThan(500);
  });
});
