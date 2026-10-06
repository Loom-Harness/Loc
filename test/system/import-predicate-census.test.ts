import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// M-T9.84 — the hand-predicated import census
// (docs/new-plan/missions/M-T9.84-derived-imports.md §7).
//
// The defect class: an emitter decides a module's import block with a
// hand-written predicate (`needsX ? "from x import X" : null`) computed
// SEPARATELY from the code that writes the usage, and the two drift — an
// unimported symbol (F821 / TS2304 / CS0246) or an unused import (F401).
// The fix is structural: write the usage through `ref(sym)` so the import
// block is derived from the emitted text.  This census counts the predicate
// sites that remain, per backend, and only lets the count go DOWN.
//
// THE DETECTOR.  A "predicated import site" is a source line under the
// backend's emitter roots carrying an import-statement string literal (per
// language, `IMPORT_LITERAL` below) that sits in a conditional or collecting
// position: directly after `?`, `:`, `&&`, `||`, `=>`, `.push(`, `.add(` or
// `.unshift(` on the same line, or alone on a line whose predecessor ends in
// `?`, `&&`, `||` or `=>` (the wrapped ternary arm).  An import literal that is
// a bare element of an unconditional `lines(...)` list is NOT counted — both
// halves of such a header are constant, so they cannot drift.
//
// It is a consistent progress measure, not a proof of absence: a predicate
// held in a variable is counted where the literal sits.  Proof of absence is
// each backend's compile/lint leg (ruff F401/F821, the TS binder gate in
// emitted-symbol-binding.test.ts, `dotnet build`, `javac`).
//
// THE RATCHET.  The count must EQUAL its ceiling.  A migration that removes
// sites lowers the ceiling in the same PR (a stale ceiling fails exactly like
// a regression), so the number on `main` is always the live one.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

type Backend = "python" | "typescript" | "dotnet" | "java" | "elixir";

const ROOTS: Record<Backend, readonly string[]> = {
  python: ["src/generator/python"],
  typescript: ["src/generator/typescript", "src/platform/hono"],
  dotnet: ["src/generator/dotnet"],
  java: ["src/generator/java"],
  elixir: ["src/generator/elixir"],
};

const IMPORT_LITERAL: Record<Backend, RegExp> = {
  python: /["'`](from [\w.]+ import\b|import [\w.]+)/,
  typescript: /["'`]import (type )?[{*\w]/,
  dotnet: /["'`]using [\w.]+/,
  java: /["'`]import (static )?[\w.]+/,
  elixir: /["'`](alias|import|require|use) [A-Z][\w.]*/,
};

/** Live count per backend — lower it in the PR that removes sites. */
const CEILING: Record<Backend, number> = {
  python: 285,
  typescript: 235,
  dotnet: 26,
  java: 51,
  elixir: 2,
};

const SAME_LINE = /(\?|:|&&|\|\||=>|\bpush\(|\badd\(|\bunshift\()\s*$/;
const PREV_LINE = /(\?|&&|\|\||=>)\s*$/;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith(".ts") && !p.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

function predicatedImportSites(backend: Backend): { file: string; line: number; text: string }[] {
  const sites: { file: string; line: number; text: string }[] = [];
  for (const root of ROOTS[backend]) {
    for (const file of tsFiles(path.join(repoRoot, root))) {
      const src = fs.readFileSync(file, "utf8").split("\n");
      src.forEach((text, i) => {
        const m = IMPORT_LITERAL[backend].exec(text);
        if (!m) return;
        const before = text.slice(0, m.index);
        const wrappedArm = /^\s*$/.test(before) && i > 0 && PREV_LINE.test(src[i - 1]!);
        if (SAME_LINE.test(before) || wrappedArm) {
          sites.push({ file: path.relative(repoRoot, file), line: i + 1, text: text.trim() });
        }
      });
    }
  }
  return sites;
}

describe("hand-predicated import census (M-T9.84)", () => {
  for (const backend of Object.keys(CEILING) as Backend[]) {
    it(`${backend}: predicated import sites equal the ratcheted ceiling`, () => {
      const n = predicatedImportSites(backend).length;
      expect(
        n,
        n > CEILING[backend]
          ? `${backend} grew a hand-predicated import (${n} > ${CEILING[backend]}). Write the usage through ref(sym) so the import is derived (docs/new-plan/missions/M-T9.84-derived-imports.md) instead of adding a predicate.`
          : `${backend} dropped to ${n} predicated import sites — lower CEILING.${backend} to ${n} in this PR.`,
      ).toBe(CEILING[backend]);
    });
  }

  it("the detector reaches its target shapes (vacuity guard)", () => {
    // Every shape the detector claims to count, on a synthetic line set —
    // so a regex edit that silently stops matching fails here, not by
    // quietly reading zero on a backend.
    const probe = (backend: Backend, line: string, prev = ""): boolean => {
      const m = IMPORT_LITERAL[backend].exec(line);
      if (!m) return false;
      const before = line.slice(0, m.index);
      return SAME_LINE.test(before) || (/^\s*$/.test(before) && PREV_LINE.test(prev));
    };
    expect(probe("python", `    usesDecimal ? "from decimal import Decimal" : null,`)).toBe(true);
    expect(probe("python", `      ? "from aio_pika.abc import X"`, "    hasRabbit")).toBe(true);
    expect(probe("python", `      "from aio_pika.abc import X",`, "    hasRabbit &&")).toBe(true);
    expect(probe("python", `    hasRedis && "import redis.asyncio as aioredis",`)).toBe(true);
    expect(probe("python", `    "from typing import Annotated",`)).toBe(false);
    expect(probe("typescript", `  usesMoney ? 'import Decimal from "decimal.js";' : null,`)).toBe(
      true,
    );
    expect(probe("dotnet", `  if (x) usings.add("using System.Text.RegularExpressions;");`)).toBe(
      true,
    );
    expect(probe("java", `    imports.push("import java.util.List;");`)).toBe(true);
    expect(probe("elixir", `    needsRepo ? "alias MyApp.Repo" : nil,`)).toBe(true);
  });
});
