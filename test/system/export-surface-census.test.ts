import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Export-surface census (Wave CR1 packet g, audit row P1-4).
//
// The audit's reachability scan found 52 exported symbols in `src/` referenced
// NOWHERE in the repo — not in `src/`, `test/`, `web/`, `scripts/`,
// `packages/`, `bin/`, and not even inside their own defining file.  It is a
// RECURRING find: `constructionSeededDefaults` was removed by hand in #2897,
// `MAP_UNRENDERED_FRAMEWORK` was a carve-out #2729 orphaned and only surfaced
// when Wave CR1's lint ratchet made warnings fail, and `renderSpaController`
// was found by the 2026-07-13 hollow-work audit.  Three hand sweeps of the
// same bug class is the definition of a missing gate.
//
// This is that gate, in two tiers:
//
//   TIER 1 — zero tolerance.  An exported declaration whose name appears in NO
//     other file AND nowhere else inside its own file is dead by every reading.
//     There is no "it's referenced dynamically" story for a name the repo never
//     spells twice.  Drained to zero by this packet; an entry may only be added
//     to ALLOW with a reason.
//
//   TIER 2 — count ratchet.  An exported VALUE (function/const/class) whose
//     only references are inside its own defining module is over-exported:
//     the `export` widens the public surface for nobody.  426 of these existed
//     when this gate landed and narrowing them all would touch ~400 files and
//     collide with every open PR, so the count is PINNED and may only fall —
//     the same shape as `test/platform/allowlist-ratchet.test.ts`.  Drop the
//     `export` when you touch such a file anyway, and lower MAX in that PR.
//
// Why a token scan and not `knip`: measured on this tree (knip 6.37.0, config
// tuned for the committed langium output, the `packages/*` publish shapes, the
// `web/` package and the entry points), knip is SILENTLY BLIND to
// `src/ir/types/loom-ir.ts` — a synthetic unused export planted at the top and
// again at the bottom of that file is reported for `src/util/color.ts`,
// `src/ir/util/walk.ts`, `src/generator/_stmt/leaves.ts` and
// `src/generator/feliz/wire.ts`, and NOT for `loom-ir.ts`, under three
// separate configs.  That file is the IR vocabulary every backend imports and
// it held 2 of the 52.  A gate that is invisibly blind to the repo's hub
// module is the exact failure this wave exists to stop, so the dependency was
// not taken.  (`test/platform/dead-generator-exports.test.ts` made the same
// call for the same reason, and stays: it is STRICTER than tier 2 over the
// `render*`/`emit*`/`build*` names it covers, requiring a reference from
// another file even for a symbol used inside its own.)
//
// Bounds, both deliberately conservative — the scan UNDER-reports:
//   - "referenced" = the identifier appears as a token in some other file.  A
//     comment mention, or a same-named export in a second backend, counts.
//   - a `.md` mention does NOT count: documenting a symbol is not using it.
//   - TYPE exports are exempt from tier 2, because a type named in an exported
//     function's signature must be exported for callers to spell the argument,
//     and the token scan cannot tell that case from a genuine over-export.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Symbols that are genuinely unreferenced by name and must stay.  EMPTY —
 *  the 52 the audit found were deleted rather than pinned.  An entry is keyed
 *  `"<repo-rel-file> :: <name>"` and must carry the reason it cannot be
 *  name-referenced (dynamic dispatch, a published entry point, …). */
const ALLOW = new Set<string>([]);

/** Pinned count of exported VALUES referenced only inside their own module.
 *  Measured at 184 when this gate landed (426 total module-local exports, of
 *  which 242 are types and therefore exempt — see the header).  Lower it when
 *  you drop an `export`; raising it is a reviewed line in the diff. */
const MODULE_LOCAL_VALUE_MAX = 184;

/** Trees whose files may REFERENCE a `src/` export.  `web/` imports the
 *  toolchain straight from `../src`; `packages/*` are publish-shaped
 *  workspaces; `scripts/` and `bin/` are entry points; `.hbs`/`.json`/`.yml`
 *  are in because a design pack or a workflow can name a symbol in a string. */
const CONSUMER_ROOTS = [
  "src",
  "test",
  "web",
  "scripts",
  "packages",
  "bin",
  "designs",
  "api",
  "vite",
  "docker",
  "stacks",
  "sveltekit",
  "vue",
  "angular",
  ".github",
];

const CONSUMER_EXT = /\.(ts|tsx|mts|cts|js|mjs|cjs|jsx|svelte|vue|hbs|json|yml|yaml)$/;
const SKIP_DIRS = new Set(["node_modules", ".git", "out", "dist", "coverage"]);

function walk(dir: string, keep: (p: string) => boolean, out: string[] = []): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walk(p, keep, out);
    } else if (keep(p)) out.push(p);
  }
  return out;
}

interface ExportedDecl {
  name: string;
  file: string;
  isType: boolean;
}

/** Every top-level `export`ed declaration with a name, via the TS AST (a regex
 *  misses `export const a = 1, b = 2`).  `export { … }` lists and `export
 *  default` are skipped: neither introduces a name this gate can attribute. */
function exportedDecls(file: string): ExportedDecl[] {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, false);
  const out: ExportedDecl[] = [];
  for (const st of sf.statements) {
    if (ts.isExportDeclaration(st) || ts.isExportAssignment(st)) continue;
    const flags = ts.getCombinedModifierFlags(st as ts.Declaration);
    if ((flags & ts.ModifierFlags.Export) === 0) continue;
    if ((flags & ts.ModifierFlags.Default) !== 0) continue;
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name)) out.push({ name: d.name.text, file, isType: false });
      continue;
    }
    const isType = ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st);
    const named =
      ts.isFunctionDeclaration(st) ||
      ts.isClassDeclaration(st) ||
      ts.isEnumDeclaration(st) ||
      ts.isModuleDeclaration(st) ||
      isType;
    if (named && st.name && ts.isIdentifier(st.name))
      out.push({ name: st.name.text, file, isType });
  }
  return out;
}

const TOKEN = /[A-Za-z_$][A-Za-z0-9_$]*/g;

describe("export-surface census (P1-4)", () => {
  const srcFiles = walk(
    path.join(repoRoot, "src"),
    (p) => /\.(ts|tsx)$/.test(p) && !p.endsWith(".d.ts"),
  ).filter((p) => !p.includes(`${path.sep}generated${path.sep}`));

  const decls = srcFiles.flatMap(exportedDecls);
  const wanted = new Set(decls.map((d) => d.name));

  // name -> files (other than the definer) that spell it, split by whether the
  // mention is code or documentation.
  const consumers = CONSUMER_ROOTS.flatMap((r) =>
    walk(path.join(repoRoot, r), (p) => CONSUMER_EXT.test(p)),
  ).filter((p) => !p.includes(`${path.sep}generated${path.sep}`));

  const mentions = new Map<string, Set<string>>();
  const selfCounts = new Map<string, Map<string, number>>();
  for (const f of new Set(consumers)) {
    let text: string;
    try {
      text = fs.readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const counts = new Map<string, number>();
    for (const m of text.matchAll(TOKEN)) {
      const n = m[0];
      if (!wanted.has(n)) continue;
      counts.set(n, (counts.get(n) ?? 0) + 1);
      let s = mentions.get(n);
      if (!s) {
        s = new Set<string>();
        mentions.set(n, s);
      }
      s.add(f);
    }
    selfCounts.set(f, counts);
  }

  const classify = (d: ExportedDecl) => {
    const seen = mentions.get(d.name) ?? new Set<string>();
    const elsewhere = [...seen].filter((f) => f !== d.file);
    if (elsewhere.length > 0) return "live" as const;
    const self = selfCounts.get(d.file)?.get(d.name) ?? 0;
    return self <= 1 ? ("dead" as const) : ("module-local" as const);
  };

  it("scans the whole src/ tree (guard against a vacuous pass)", () => {
    expect(srcFiles.length).toBeGreaterThan(800);
    expect(decls.length).toBeGreaterThan(3000);
    expect(consumers.length).toBeGreaterThan(2000);
  });

  it("no export is referenced nowhere at all — not even in its own file", () => {
    const dead: string[] = [];
    for (const d of decls) {
      const key = `${path.relative(repoRoot, d.file)} :: ${d.name}`;
      if (ALLOW.has(key)) continue;
      if (classify(d) === "dead") dead.push(key);
    }
    expect(
      dead,
      "Export(s) referenced NOWHERE — not by another file, not inside their own. " +
        "Delete them; that is what this gate is for.  If one is genuinely " +
        "unreferenceable by name (dynamic dispatch, a published entry point), " +
        "pin it in ALLOW with the reason.\n" +
        dead.join("\n"),
    ).toEqual([]);
  });

  it("the module-local VALUE export count only falls", () => {
    const local = decls.filter((d) => !d.isType && classify(d) === "module-local");
    expect(
      local.length,
      `${local.length} exported values are referenced only inside their own module ` +
        `(pinned max ${MODULE_LOCAL_VALUE_MAX}).  Drop the \`export\` and lower ` +
        "MODULE_LOCAL_VALUE_MAX in the same PR.",
    ).toBeLessThanOrEqual(MODULE_LOCAL_VALUE_MAX);
    // Strict reminder: when a drain lands, the baseline must follow it down.
    expect(
      MODULE_LOCAL_VALUE_MAX - local.length,
      `MODULE_LOCAL_VALUE_MAX is ${MODULE_LOCAL_VALUE_MAX} but only ${local.length} ` +
        "module-local value exports remain — lower the pin to match.",
    ).toBeLessThanOrEqual(0);
  });
});
