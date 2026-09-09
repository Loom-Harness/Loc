// Census of MODULE-GLOBAL MUTABLE STATE in `src/`, and the discipline that
// keeps each entry from leaking across a test-file boundary.
//
// WHY THIS EXISTS.  `vitest.config.ts` runs the unit project with
// `isolate: false` — one module graph per worker, deliberately, because it
// takes the full run from >10 min to ~6.  The cost is that every module-level
// binding is SHARED by every test file the worker happens to run.  A module
// global that one file mutates and does not restore is therefore a coin-flip
// for every later file in that worker: green or red purely on the file-to-
// worker assignment, with a failure whose cause looks unrelated to whichever
// file exposes it.
//
// That is not hypothetical.  `test/util/source-types.test.ts` failed on three
// assertions about a `clickhouseCloud` sourceType it never declares — written
// into the shared registry by `test/platform/source-type-plugins.test.ts`,
// which deleted its temp DIRECTORY but not its registry ENTRY.  Both files
// predated the change that exposed it; all that moved was the file set, and
// with it the worker assignment.  It was found by a full run going red, which
// is the expensive way to find this class.
//
// WHAT THIS PINS.  Every module-scope `let`, and every module-scope
// `const X = new Map/Set/WeakMap/WeakSet` or array literal that is mutated in
// its own file, must appear below with a DISCIPLINE saying why it cannot leak.
// A new one fails as UNPINNED; a pinned one that no longer exists fails as
// STALE, so the table can only shrink without a deliberate edit.  Both
// directions matter — a census that only ratchets one way rots into a list of
// things that used to be true.
//
// The scan uses the TypeScript parser rather than a regex, and that is load-
// bearing: five of this repo's most convincing-looking grep hits
// (`nextId` in `svelte/emit-templates.ts`, the four `let`s in
// `hono/v4/auth-emit.ts`, `subscribers`/`rooms` in `realtime-builder.ts`) live
// inside TEMPLATE LITERALS — they are EMITTED code, module-global in the
// GENERATED project and irrelevant here.  A regex census reports them and
// buries the real entries in noise.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

type Discipline =
  /** Saved and restored across a call via `try`/`finally`. */
  | "scoped-restore"
  /** Reassigned unconditionally at the start of every run, before any read. */
  | "per-run-reset"
  /** Built once from constants and never mutated after; readers never mutate. */
  | "build-once-cache"
  /** A WeakMap/WeakSet keyed by an owning object; entries die with the key. */
  | "keyed-cache"
  /** Set once at module wiring to break an import cycle; never reassigned after. */
  | "wiring-injection"
  /** Restored by an exported hook, named in `hook`. */
  | "test-reset-hook";

interface Pin {
  discipline: Discipline;
  reason: string;
  /** Required for `test-reset-hook`: the exported restorer, asserted to exist. */
  hook?: { file: string; name: string };
}

// key = "<file>:<identifier>"
const PINNED: Record<string, Pin> = {
  "src/generator/_payload/provenanced-wire.ts:provNamesCache": {
    discipline: "keyed-cache",
    reason: "WeakMap keyed by the aggregate map it derives from; dies with that map.",
  },
  "src/ir/lower/lower-expr.ts:ambientEnumIndex": {
    discipline: "per-run-reset",
    reason: "`lowerModel` calls `setAmbientEnumIndex` before lowering any body (lower.ts:271).",
  },
  "src/ir/lower/lower-expr.ts:topLevelFnIndex": {
    discipline: "per-run-reset",
    reason: "`lowerModel` calls `setTopLevelFnIndex` before lowering any body (lower.ts:293).",
  },
  "src/ir/lower/lower-expr.ts:uiEnumIndexByRoot": {
    discipline: "keyed-cache",
    reason: "WeakMap keyed by the AST root node.",
  },
  "src/ir/lower/lower-test.ts:hoistedTestsBySubject": {
    discipline: "per-run-reset",
    reason: "Reassigned wholesale by the hoist pass at the start of each lowering.",
  },
  "src/ir/lower/lower-types.ts:ambientDeclIndex": {
    discipline: "per-run-reset",
    reason: "Reassigned wholesale before any type is lowered.",
  },
  "src/language/print/print-expr.ts:printStatement": {
    discipline: "wiring-injection",
    reason:
      "Late-bound `printStmt` reference, installed once to break the " +
      "print-expr / print-stmt import cycle.  Never reassigned per call.",
  },
  "src/language/print/print-expr.ts:currentCol": {
    discipline: "scoped-restore",
    reason: "`withColumn` and `atColumn` both restore the prior column in a `finally`.",
  },
  "src/language/stdlib.ts:cached": {
    discipline: "build-once-cache",
    reason: "Parsed stdlib decls, built once; consumers only read.",
  },
  "src/language/type-system.ts:lettingInFlight": {
    discipline: "scoped-restore",
    reason:
      "Re-entrancy guard for let-type inference; the `add` is paired with a " +
      "`finally { delete }`, so a throwing initializer cannot leave the node latched.",
  },
  "src/macros/api/factories-internals.ts:_activeOrigin": {
    discipline: "scoped-restore",
    reason: "`_withOrigin` saves the previous origin and restores it in a `finally`.",
  },
  "src/macros/expander.ts:_diagnosticsByDoc": {
    discipline: "keyed-cache",
    reason: "WeakMap keyed by LangiumDocument.",
  },
  "src/macros/expander.ts:_macroDepsByDoc": {
    discipline: "keyed-cache",
    reason: "WeakMap keyed by LangiumDocument.",
  },
  "src/macros/prelude.ts:_cache": {
    discipline: "build-once-cache",
    reason:
      "Built-in capabilities, built once.  The expander deep-clones their members " +
      "into each implementing aggregate, so the cached nodes are never mutated.",
  },
  "src/macros/registry.ts:registry": {
    discipline: "test-reset-hook",
    reason:
      "COUPLED — see the hook's own doc comment.  `_resetRegistryForTests()` empties " +
      "the registry but does NOT bring the stdlib back: `loadStdlibMacros()` latches " +
      "on `_loaded` in stdlib/index.ts.  A caller must either replay the prior " +
      "contents in order, or also call `_resetStdlibLoadFlag()`.  " +
      "`test/macro/registry-unit.test.ts` demonstrates both halves.",
    hook: { file: "src/macros/registry.ts", name: "_resetRegistryForTests" },
  },
  "src/macros/stdlib/index.ts:_loaded": {
    discipline: "test-reset-hook",
    reason: "Boot-once latch for the stdlib registration; the other half of the pair above.",
    hook: { file: "src/macros/stdlib/index.ts", name: "_resetStdlibLoadFlag" },
  },
  "src/platform/metadata.ts:backendVersionSource": {
    discipline: "test-reset-hook",
    reason: "Injectable version source for out-of-tree backends.",
    hook: { file: "src/platform/metadata.ts", name: "resetBackendVersionSource" },
  },
  "src/platform/registry.ts:backendSource": {
    discipline: "test-reset-hook",
    reason:
      "Injectable backend-discovery source (the playground injects a VFS-backed one). " +
      "`resetBackendSource` also restores the metadata version source it sets.",
    hook: { file: "src/platform/registry.ts", name: "resetBackendSource" },
  },
  "src/system/traceability.ts:nodeSeq": {
    discipline: "per-run-reset",
    reason:
      "`renderTraceabilityDiagram` sets it to 0 as its first statement, so emitted " +
      "node ids do not depend on how many diagrams the process rendered before.",
  },
  "src/util/source-types.ts:REGISTRY": {
    discipline: "test-reset-hook",
    reason:
      "The registry the clickhouseCloud leak escaped through.  The hook re-seeds the " +
      "built-ins, so overriding a built-in name restores it rather than removing it.",
    hook: { file: "src/util/source-types.ts", name: "_unregisterSourceTypeForTests" },
  },
};

// ---------------------------------------------------------------------------

const MUTATORS = new Set([
  "set",
  "add",
  "delete",
  "clear",
  "push",
  "pop",
  "splice",
  "shift",
  "unshift",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
]);

const CONTAINER_CTORS = new Set(["Map", "Set", "WeakMap", "WeakSet"]);

function sourceFiles(): string[] {
  // `src/language/generated/` is committed `langium generate` output, not
  // hand-written source — its module state is regenerated, not maintained.
  return execFileSync("find", ["src", "-name", "*.ts", "-not", "-path", "*/generated/*"], {
    encoding: "utf8",
  })
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
}

/** Every module-scope mutable binding, as "<file>:<identifier>". */
function scan(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles()) {
    const text = readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true);

    // Only `sf.statements` — top level. Anything nested in a function, class or
    // template literal is out of scope by construction.
    for (const st of sf.statements) {
      if (!ts.isVariableStatement(st)) continue;
      const isLet = (st.declarationList.flags & ts.NodeFlags.Let) !== 0;
      const isConst = (st.declarationList.flags & ts.NodeFlags.Const) !== 0;

      for (const decl of st.declarationList.declarations) {
        if (!ts.isIdentifier(decl.name)) continue;
        const name = decl.name.text;

        if (isLet) {
          found.push(`${file}:${name}`);
          continue;
        }
        if (!isConst || !decl.initializer) continue;

        const init = decl.initializer;
        const isContainer =
          (ts.isNewExpression(init) &&
            ts.isIdentifier(init.expression) &&
            CONTAINER_CTORS.has(init.expression.text)) ||
          ts.isArrayLiteralExpression(init);
        if (!isContainer) continue;

        // A `const` container only counts when this file actually mutates it.
        // A frozen lookup table (the ~130 keyword/primitive Sets) is not shared
        // mutable state and would drown the census.
        let mutated = false;
        const visit = (n: ts.Node): void => {
          if (mutated) return;
          if (
            ts.isCallExpression(n) &&
            ts.isPropertyAccessExpression(n.expression) &&
            ts.isIdentifier(n.expression.expression) &&
            n.expression.expression.text === name &&
            MUTATORS.has(n.expression.name.text)
          ) {
            mutated = true;
            return;
          }
          ts.forEachChild(n, visit);
        };
        ts.forEachChild(sf, visit);
        if (mutated) found.push(`${file}:${name}`);
      }
    }
  }
  return found.sort();
}

describe("module-global mutable state in src/", () => {
  const found = scan();

  it("finds nothing unpinned — every module global declares how it cannot leak", () => {
    const unpinned = found.filter((k) => !(k in PINNED));
    expect(
      unpinned,
      unpinned.length === 0
        ? ""
        : `${unpinned.length} module-global(s) in src/ are not in the census.\n` +
            `Under \`isolate: false\` an unrestored module global is an order-dependent\n` +
            `failure in an unrelated test FILE.  Add each to PINNED with the discipline\n` +
            `that makes it safe — or give it one first:\n  ${unpinned.join("\n  ")}`,
    ).toEqual([]);
  });

  it("has no stale pins — the census can only shrink", () => {
    const live = new Set(found);
    const stale = Object.keys(PINNED).filter((k) => !live.has(k));
    expect(
      stale,
      stale.length === 0
        ? ""
        : `${stale.length} pinned entr(y/ies) no longer exist in src/.  Delete them ` +
            `from PINNED in the same change that removed the state:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every `test-reset-hook` names a restorer that is actually exported", () => {
    // Without this the discipline is a comment.  A renamed or deleted hook has
    // to fail here rather than the next time someone trusts the table.
    const broken: string[] = [];
    for (const [key, pin] of Object.entries(PINNED)) {
      if (pin.discipline !== "test-reset-hook") continue;
      if (!pin.hook) {
        broken.push(`${key}: discipline is test-reset-hook but no hook is named`);
        continue;
      }
      const src = readFileSync(pin.hook.file, "utf8");
      if (!new RegExp(`export function ${pin.hook.name}\\b`).test(src)) {
        broken.push(`${key}: ${pin.hook.file} exports no \`${pin.hook.name}\``);
      }
    }
    expect(broken, broken.join("\n")).toEqual([]);
  });

  it("keeps the coupled macro-registry pair together", () => {
    // The one genuine trap the census found, kept explicit because the fix is a
    // convention rather than a mechanism: the two hooks cannot be fused without
    // closing an import cycle (stdlib/index.ts already imports registerMacro
    // from registry.ts), so what stops the trap is that both are pinned and
    // this assertion names the pairing.
    expect(PINNED["src/macros/registry.ts:registry"]?.hook?.name).toBe("_resetRegistryForTests");
    expect(PINNED["src/macros/stdlib/index.ts:_loaded"]?.hook?.name).toBe("_resetStdlibLoadFlag");

    const registrySrc = readFileSync("src/macros/registry.ts", "utf8");
    // The doc comment used to claim "Stdlib re-registers itself on next import",
    // which is false and is exactly how a caller walks into the trap.
    expect(registrySrc).not.toMatch(/[Ss]tdlib re-registers\s+\*?\s*itself/);
    expect(registrySrc).toMatch(/_resetStdlibLoadFlag/);
  });
});
