import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

// ---------------------------------------------------------------------------
// Legacy single-context `generate` ratchet.
//
// The sibling ratchet (`direct-generate-systems-ratchet.test.ts`) pins the
// tests that import the SYSTEM orchestrator directly.  This one pins the other
// half of the same hole: callers of the legacy single-context .NET wrapper
// `generateDotnet` in `test/_helpers/generate.ts` (`ddd generate dotnet`).
// The Hono twin, `generateHono`, has no callers left and no longer exists, so
// a new caller fails to compile rather than needing a row here.
//
// The wrapper calls `assertModelVerifies(model)`, so phases ⑤/⑥/⑦ are
// asserted for every call site.  Phases ① and ④ CANNOT be asserted there — it
// takes a `Model`, not a source string — which is why they stay the caller's
// job and why the `parseString` column below is pinned separately.
//
// The replacement for a pinned file is `generateBackendFiles(contexts,
// "dotnet")` (bare `context { … }` fixtures) or `generateSystemFiles(source)`:
// both emit through the orchestrator `ddd generate system` runs and assert
// ①/④ as well.
//
// Three directions, all ratcheting:
//
//   NEW FILE  — a test file that imports the wrapper and is not pinned fails.
//   STALE     — a pinned file that no longer imports it fails, so a migration
//               deletes its pin in the same commit.
//   COUNT     — the total call-site count is pinned EXACTLY, not as a ceiling,
//               so adding a call to an already-pinned file fails too.
//
// WHY THE LEGACY PATH CANNOT HOST A CAPABILITY: `generateDotnet` emits from
// `loom.contexts` — the LOOSE top-level contexts — and declaring a `system`
// re-parents every loose context into it, emptying that list.  So a fixture on
// this path has, by construction, no backend deployable, and every
// hosted-capability check refuses it (`loom.tph-backend-unsupported`,
// `loom.audited-backend-unsupported`, `loom.event-sourcing-backend-unsupported`
// and their siblings).  Those fixtures belong on the orchestrator.
//
// What this ratchet does NOT see: a test importing the generator straight
// from `src/` (`generateTypeScript`, `src/generator/dotnet/index.js`), which
// never touches the helper — tracked separately.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const testRoot = path.join(repoRoot, "test");

/**
 * Files still on the legacy single-context .NET path, with their call-site
 * count.  This is a BACKLOG, not an allowance.
 *
 * `test/_helpers/generate.ts` is the one legitimate importer — it IS the gated
 * wrapper — and is exempted below rather than pinned.
 */
const PINNED_DOTNET: Readonly<Record<string, number>> = {
  // Both also pinned by `direct-generate-systems-ratchet.test.ts`; moving
  // either drops it from both tables in the same change.
  "test/adapters/dotnet-orchestrator-rewire.test.ts": 1,
  "test/generator/dotnet/paged-emit.test.ts": 1,
};

/**
 * The second column: a pinned file that ALSO calls `parseString`.
 *
 * `parseString` covers neither phase ① (it returns the error-recovered AST
 * without complaint) nor phase ④ unless the caller reads `errors` — so a
 * `parseString` → legacy-generate hop is a double bypass.  The reason is the point: an entry with no reason is a bypass nobody decided
 * on.
 *
 * A migration deletes its entry, and a NEW file appearing here fails — the
 * ratchet is on the map's keys, not on its size.
 */
const PARSE_STRING_ALONGSIDE_DOTNET: Readonly<Record<string, string>> = {};

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "fixtures") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) testFiles(full, out);
    else if (entry.isFile() && /\.[cm]?tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** `true` when the specifier resolves to the shared test helper barrel. */
const isHelperModule = (spec: string): boolean =>
  /(^|\/)_helpers\/(generate|index)\.js$/.test(spec);

type Row = { file: string; calls: number; usesParseString: boolean };

/**
 * Every test-tree file importing ONE legacy single-context generator from the
 * helper, its call count, and whether it also calls `parseString` — plus the
 * number of files scanned (the vacuous-pass guard).
 *
 * Per-gate rather than pooled: `paged-wire-parity` imports both, and a pooled
 * count would let a call migrate off one path onto the other without moving the
 * total.
 */
function census(gate: string): { rows: Row[]; scanned: number } {
  const rows: Row[] = [];
  let scanned = 0;

  for (const file of testFiles(testRoot)) {
    scanned++;
    const text = fs.readFileSync(file, "utf8");
    // Cheap prefilter — the AST parse below is the authority.
    if (!text.includes(gate)) continue;
    const rel = path.relative(repoRoot, file);
    if (rel === "test/_helpers/generate.ts") continue;

    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);

    // TWO passes, deliberately.  A single walk would have to see the import
    // before the call that uses the local name, and while an `import` is always
    // top-level, a re-exporting barrel or an aliased binding is not guaranteed
    // to be visited first — a miscount here reads as a shrinking ratchet, the
    // exact failure this file exists to prevent.
    const imported = new Set<string>();
    const collectImports = (node: ts.Node): void => {
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        isHelperModule(node.moduleSpecifier.text)
      ) {
        const bindings = node.importClause?.namedBindings;
        if (bindings && ts.isNamedImports(bindings)) {
          for (const el of bindings.elements) {
            if ((el.propertyName ?? el.name).text === gate) imported.add(el.name.text);
          }
        }
      }
      ts.forEachChild(node, collectImports);
    };
    collectImports(sf);
    if (imported.size === 0) continue;

    let calls = 0;
    let usesParseString = false;
    const countCalls = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        if (imported.has(node.expression.text)) calls++;
        if (node.expression.text === "parseString") usesParseString = true;
      }
      ts.forEachChild(node, countCalls);
    };
    countCalls(sf);

    if (calls > 0) rows.push({ file: rel, calls, usesParseString });
  }
  return { rows: rows.sort((a, b) => a.file.localeCompare(b.file)), scanned };
}

/**
 * The legacy single-context entry points still in use, each with its own
 * pinned columns.  A second would be a second row here; the assertions below
 * are written once.
 */
const GATES = [
  {
    gate: "generateDotnet",
    pinned: PINNED_DOTNET,
    parseStringAlongside: PARSE_STRING_ALONGSIDE_DOTNET,
  },
] as const;

for (const { gate, pinned, parseStringAlongside } of GATES) {
  describe(`legacy single-context \`${gate}\` callers under test/`, () => {
    const { rows, scanned } = census(gate);

    it("scans the whole test tree (guard against a vacuous pass)", () => {
      // If the walker silently stopped finding files, every assertion below
      // would pass on an empty set.
      expectReach("test files", scanned, 2472);
      // Every pinned file must still be found: a scan that stopped reaching them
      // would otherwise read as a drained backlog.
      expectReach("pinned rows", rows.length, Object.keys(pinned).length);
    });

    it("no NEW file on the legacy single-context path", () => {
      const added = rows.map((r) => r.file).filter((f) => !(f in pinned));
      expect(
        added,
        `${added.length} test file(s) newly reach the legacy single-context generator. ` +
          `Use generateSystemFiles(source) instead — it emits through the orchestrator the ` +
          `CLI runs, asserts phases ①/④ as well as ⑤/⑥/⑦, and is the only path on which a ` +
          `hosted capability (TPH, audited, event-sourced, tenancy) can be expressed.`,
      ).toEqual([]);
    });

    it("no STALE pin (the file list ratchets down)", () => {
      const live = new Set(rows.map((r) => r.file));
      const gone = Object.keys(pinned).filter((f) => !live.has(f));
      expect(
        gone,
        `${gone.length} pinned file(s) no longer reach the legacy generator — delete their ` +
          `entries from the PINNED table in the same change that migrated them.`,
      ).toEqual([]);
    });

    it("the call-site count is pinned EXACTLY, so it can only shrink", () => {
      // Exact, not a ceiling: a ceiling lets a new call slip into an
      // already-pinned file, which is how 62 + 150 accumulated in the first
      // place.
      const live = Object.fromEntries(rows.map((r) => [r.file, r.calls]));
      expect(live).toEqual(pinned);
    });

    it("the total is pinned too (one number to watch shrink)", () => {
      const total = rows.reduce((n, r) => n + r.calls, 0);
      const expected = Object.values(pinned).reduce((n, c) => n + c, 0);
      expect(total, `legacy call sites: ${total} (pinned ${expected})`).toBe(expected);
    });

    it("every `parseString` → legacy-generate file carries a stated reason", () => {
      const live = rows.filter((r) => r.usesParseString).map((r) => r.file);
      const undocumented = live.filter((f) => !(f in parseStringAlongside));
      expect(
        undocumented,
        `${undocumented.length} file(s) call both parseString and the legacy generator with no ` +
          `reason recorded.  parseString asserts NEITHER phase ① nor phase ④, and the legacy ` +
          `wrapper cannot assert them for you (it takes a Model, not a source) — so reach for ` +
          `parseValid, or add an entry to the PARSE_STRING_ALONGSIDE table saying why this one ` +
          `is fine.`,
      ).toEqual([]);
      const stale = Object.keys(parseStringAlongside).filter((f) => !live.includes(f));
      expect(
        stale,
        `${stale.length} PARSE_STRING_ALONGSIDE entry/entries are stale — delete them in the ` +
          `same change that migrated the file to parseValid.`,
      ).toEqual([]);
    });
  });
}
