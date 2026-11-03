import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { expectReach } from "../_helpers/census-reach.js";

// ---------------------------------------------------------------------------
// Direct-caller ratchet (minted by M-T9.35, now done; the drain of `PINNED`
// below is owned by M-T9.75 — https://github.com/Loom-Harness/Loc/blob/cadbe3ba12fb833565704cb9d628c8f41b2090a8/docs/new-plan/T9-toolchain-health.md).
//
// `test/_helpers/generate.ts` is where a fixture is checked before anything
// asserts on what it emits — phase ① (syntax), ④ (AST validation) and ⑦
// (`validateLoomModel`).  A test that imports `generateSystems` /
// `generateSystemsFromLoom` straight from `src/system/index.js` bypasses all
// three, so no assertion added to the helper can ever reach it.  That is how
// 166 error-carrying generations survived M-T9.34's flip: they were never on
// the helper's path in the first place.
//
// This pins the remaining set so it can only SHRINK.  Two directions, both
// ratcheting:
//
//   NEW      — a file that imports the orchestrator directly and is not pinned
//              fails.  Reach for `generateSystemFiles(source, options?)` /
//              `generateSystemResult(source, options?)` instead; if the fixture
//              must stay one the product refuses, that is
//              `generateSystemFilesUnchecked(source, why)`.
//   STALE    — a pinned file that no longer imports it fails, so a migration
//              deletes its pin in the same commit.
//
// The list MOVES: roughly two new direct importers land on `main` per day, so a
// pin list minted days before it merges is stale on arrival — this PR was split
// out of the drain for exactly that reason.  Regenerate immediately before
// merging with `node scripts/direct-caller-census.mjs` and paste over `PINNED`.
//
// Only the IMPORT is matched, not usage: a file that imports the symbol has
// the capability, and re-export laundering (`export { generateSystems }` from
// a helper) is caught because the helper barrel is scanned too.
// ---------------------------------------------------------------------------

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const testRoot = path.join(repoRoot, "test");

/** The orchestrator entry points a test must not import directly. */
const GATED = new Set(["generateSystems", "generateSystemsFromLoom"]);

/**
 * Files still importing the orchestrator directly, as of M-T9.35.
 *
 * This list is a BACKLOG, not an allowance.  Every entry is a fixture whose
 * pipeline-phase coverage is whatever its own `parseValid` / manual
 * diagnostics-check happens to do — `parseValid` covers ① + ④, a bare
 * `parseString` covers neither, and nothing here covers ⑦.
 *
 * `test/_helpers/generate.ts` is the one legitimate importer — it IS the
 * gated wrapper — and is exempted below rather than pinned.
 */
const PINNED: readonly string[] = [
  "test/conformance/corpus-mutation.test.ts",
  "test/generator/vue/sourcemap.test.ts",
  "test/generator/vue/vue-embedding.test.ts",
  "test/generator/walker-match-expression.test.ts",
  "test/ir/audited.test.ts",
  "test/ir/provenance.test.ts",
  "test/language/lsp/lsp-implementation.test.ts",
  "test/language/parsing/aggregate-inheritance.test.ts",
  "test/language/parsing/top-level-subdomain.test.ts",
  "test/macro/version-field-collision.test.ts",
  "test/pairwise/harness.ts",
  "test/platform/backend-parity-gates.test.ts",
  "test/platform/dotnet-fullstack.test.ts",
  "test/platform/dotnet-multi-context-eventlog-naming.test.ts",
  "test/platform/frontend-dispatch.test.ts",
  "test/playground/multifile-vfs-loader.test.ts",
  "test/system/architecture-integration.test.ts",
  "test/system/kubernetes-helm.test.ts",
  "test/system/launch-config.test.ts",
  "test/system/multifile-regression.test.ts",
  "test/system/node-debug.test.ts",
  "test/system/playground-feature-examples.test.ts",
  "test/system/playground-remaining-examples.test.ts",
  "test/system/playground-storybook-examples.test.ts",
  "test/system/prometheus-collector.test.ts",
  "test/system/sourcemap.test.ts",
  "test/system/storage-sidecars.test.ts",
  "test/system/system.test.ts",
  "test/system/trace-roundtrip.test.ts",
  "test/system/traceability.test.ts",
];

function testFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "fixtures") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) testFiles(full, out);
    else if (entry.isFile() && /\.[cm]?tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/** `true` when the module specifier resolves to `src/system/index.js`. */
const isOrchestratorModule = (spec: string): boolean => /(^|\/)src\/system\/index\.js$/.test(spec);

/**
 * Every test-tree file importing a gated symbol from the orchestrator, plus
 * the number of files scanned (the vacuous-pass guard).
 */
function census(): { importers: string[]; scanned: number } {
  const importers: string[] = [];
  let scanned = 0;

  for (const file of testFiles(testRoot)) {
    scanned++;
    const text = fs.readFileSync(file, "utf8");
    // Cheap prefilter — the AST parse below is the authority.
    if (!text.includes("src/system/index.js")) continue;
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    const rel = path.relative(repoRoot, file);
    let hit = false;

    const named = (bindings: ts.NamedImportBindings | undefined): boolean =>
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((e) => GATED.has((e.propertyName ?? e.name).text));

    const visit = (node: ts.Node): void => {
      if (hit) return;
      // `import { generateSystems } from ".../src/system/index.js"`
      if (
        ts.isImportDeclaration(node) &&
        ts.isStringLiteral(node.moduleSpecifier) &&
        isOrchestratorModule(node.moduleSpecifier.text) &&
        named(node.importClause?.namedBindings)
      ) {
        hit = true;
        return;
      }
      // `const { generateSystems } = await import(".../src/system/index.js")`
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0]!) &&
        isOrchestratorModule((node.arguments[0] as ts.StringLiteral).text)
      ) {
        // The binding is on the enclosing declaration / await expression.
        let owner: ts.Node | undefined = node.parent;
        while (owner && !ts.isVariableDeclaration(owner) && !ts.isSourceFile(owner)) {
          owner = owner.parent;
        }
        if (
          owner &&
          ts.isVariableDeclaration(owner) &&
          ts.isObjectBindingPattern(owner.name) &&
          owner.name.elements.some((e) =>
            GATED.has(((e.propertyName ?? e.name) as ts.Identifier).text ?? ""),
          )
        ) {
          hit = true;
          return;
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    // The gated wrapper itself is the one legitimate importer.
    if (hit && rel !== "test/_helpers/generate.ts") importers.push(rel);
  }
  return { importers: importers.sort(), scanned };
}

describe("direct `generateSystems` importers under test/ (M-T9.35)", () => {
  const { importers, scanned } = census();

  it("scans the whole test tree (guard against a vacuous pass)", () => {
    // If the walker silently stopped finding files, every assertion below
    // would pass on an empty set.
    expectReach("test files", scanned, 2472);
  });

  it("no NEW direct importer", () => {
    const pinned = new Set(PINNED);
    const added = importers.filter((f) => !pinned.has(f));
    expect(
      added,
      `${added.length} test file(s) import the system orchestrator directly, bypassing the ` +
        `phase ①/④/⑦ assertions in test/_helpers/generate.ts.  Use ` +
        `generateSystemFiles(source, options?) or generateSystemResult(source, options?) — ` +
        `or generateSystemFilesUnchecked(source, why) if the fixture must stay one the ` +
        `product refuses.`,
    ).toEqual([]);
  });

  it("no STALE pin (the list ratchets down)", () => {
    const live = new Set(importers);
    const gone = PINNED.filter((f) => !live.has(f));
    expect(
      gone,
      `${gone.length} pinned file(s) no longer import the orchestrator directly — delete ` +
        `their entries from PINNED in the same change that migrated them.`,
    ).toEqual([]);
  });
});
