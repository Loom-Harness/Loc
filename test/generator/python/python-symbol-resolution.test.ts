// Every name a generated Python module USES must be one it defines or imports.
//
// F-027's shape: a cross-context `X id` parameter made the FastAPI route emit
// `FooId(body.fooId)` while the route's `from app.domain.ids import …` line
// listed only the aggregate's own id.  The service byte-compiles, imports,
// boots and serves `/ready` — and then raises `NameError` the first time anyone
// posts to that route.  `python -m compileall` is blind to it (a name is
// resolved at call time, not compile time) and so is `import app.main` (the
// route body never runs).  Only `mypy` sees it, and the generated Dockerfile
// builds with `uv sync --no-dev`, so the shipped image never runs mypy.
//
// The specific alias is fixed and pinned by
// `routes-cross-aggregate-id-import.test.ts`.  This gate is the AXIS instead:
// not "is FooId imported" but "does every capitalised name in this module
// resolve" — because the same sentence has been written about a different alias
// repeatedly (`experience_gathered.md` §104), and a per-alias regression test
// only ever closes the instance in front of it.
//
// Scope, deliberately narrow so it stays free of false positives:
//   - Only names starting with a capital, in call / subscript / attribute
//     position.  Every emitted class, id wrapper, enum, DTO and library symbol
//     is PascalCase; a lowercase miss would need real scope analysis (locals,
//     comprehension targets, closures) and is not the defect class.
//   - Allowlisted names are the CPython builtins and NOTHING else.  A library
//     symbol (`Decimal`, `Optional`, `UUID`, `BaseModel`) must be imported by
//     the module that uses it, which is exactly the property under test.
//
// Measured on landing: 75 corpus features × the python backend, ZERO findings.
// The gate is proved to fire by deleting one name from one emitted import line.
import { describe, expect, it } from "vitest";
import { generateCorpusCase } from "../../fixtures/corpus/harness.js";
import { CORPUS } from "../../fixtures/corpus/manifest.js";

/** `dir(builtins)`, capitalised entries only — the complete set a module may
 *  use without importing.  Anything else is the module's own responsibility. */
const PY_BUILTINS = new Set([
  "ArithmeticError",
  "AssertionError",
  "AttributeError",
  "BaseException",
  "BaseExceptionGroup",
  "BlockingIOError",
  "BrokenPipeError",
  "BufferError",
  "BytesWarning",
  "ChildProcessError",
  "ConnectionAbortedError",
  "ConnectionError",
  "ConnectionRefusedError",
  "ConnectionResetError",
  "DeprecationWarning",
  "EOFError",
  "Ellipsis",
  "EncodingWarning",
  "EnvironmentError",
  "Exception",
  "ExceptionGroup",
  "False",
  "FileExistsError",
  "FileNotFoundError",
  "FloatingPointError",
  "FutureWarning",
  "GeneratorExit",
  "IOError",
  "ImportError",
  "ImportWarning",
  "IndentationError",
  "IndexError",
  "InterruptedError",
  "IsADirectoryError",
  "KeyError",
  "KeyboardInterrupt",
  "LookupError",
  "MemoryError",
  "ModuleNotFoundError",
  "NameError",
  "None",
  "NotADirectoryError",
  "NotImplemented",
  "NotImplementedError",
  "OSError",
  "OverflowError",
  "PendingDeprecationWarning",
  "PermissionError",
  "ProcessLookupError",
  "RecursionError",
  "ReferenceError",
  "ResourceWarning",
  "RuntimeError",
  "RuntimeWarning",
  "StopAsyncIteration",
  "StopIteration",
  "SyntaxError",
  "SyntaxWarning",
  "SystemError",
  "SystemExit",
  "TabError",
  "TimeoutError",
  "True",
  "TypeError",
  "UnboundLocalError",
  "UnicodeDecodeError",
  "UnicodeEncodeError",
  "UnicodeError",
  "UnicodeTranslateError",
  "UnicodeWarning",
  "UserWarning",
  "ValueError",
  "Warning",
  "ZeroDivisionError",
]);

/** Strip string literals and comments so their contents cannot be read as code.
 *  Triple-quoted first (they can contain the single-quoted forms). */
function stripLiterals(src: string): string {
  return src
    .replace(/"""[\s\S]*?"""/g, '""')
    .replace(/'''[\s\S]*?'''/g, "''")
    .replace(/(?<!\\)"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/(?<!\\)'(?:[^'\\\n]|\\.)*'/g, "''")
    .replace(/#[^\n]*/g, "");
}

/** Names the module brings into scope: imports (incl. `as` aliases and the
 *  parenthesised multi-line form), `def`/`class` definitions, assignment
 *  targets, `with … as` / `except … as`, and `for` targets. */
function definedNames(src: string): Set<string> {
  const d = new Set<string>();
  const add = (n: string) => {
    if (n) d.add(n);
  };
  for (const m of src.matchAll(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/gm)) add(m[1]!);
  for (const m of src.matchAll(/^\s*class\s+([A-Za-z_]\w*)/gm)) add(m[1]!);
  for (const m of src.matchAll(/^\s*import\s+([\w.,\s]+)$/gm))
    for (const p of m[1]!.split(",")) add(p.trim().split(".")[0]!);
  const importedNames = (list: string) => {
    for (const p of list.split(",")) {
      const t = p.trim();
      if (t && t !== "*") add((t.split(/\s+as\s+/).pop() ?? t).trim());
    }
  };
  for (const m of src.matchAll(/^\s*from\s+[\w.]*\s+import\s+\(([\s\S]*?)\)/gm))
    importedNames(m[1]!);
  for (const m of src.matchAll(/^\s*from\s+[\w.]*\s+import\s+(?!\()([^\n]*)/gm))
    importedNames(m[1]!);
  for (const m of src.matchAll(/^\s*([A-Za-z_]\w*)\s*(?::[^=\n]+)?=[^=]/gm)) add(m[1]!);
  for (const m of src.matchAll(/\bas\s+([A-Za-z_]\w*)/g)) add(m[1]!);
  for (const m of src.matchAll(/\bfor\s+([A-Za-z_][\w,\s]*?)\s+in\b/g))
    for (const p of m[1]!.split(",")) add(p.trim());
  return d;
}

/** Capitalised names in call / subscript / attribute position, excluding
 *  attribute access on something else (`self.Foo`, `models.Base`). */
function usedNames(src: string): Map<string, number> {
  const u = new Map<string, number>();
  src.split("\n").forEach((line, i) => {
    for (const m of line.matchAll(/(?:^|[^.\w])([A-Z]\w*)\s*(?=[([.])/g)) {
      if (!u.has(m[1]!)) u.set(m[1]!, i + 1);
    }
  });
  return u;
}

/** Every unresolved capitalised name in a generated file map's `.py` files. */
export function unresolvedPythonNames(files: Map<string, string>): string[] {
  const out: string[] = [];
  for (const [path, raw] of files) {
    if (!path.endsWith(".py")) continue;
    const src = stripLiterals(raw);
    const defined = definedNames(src);
    for (const [name, line] of usedNames(src)) {
      if (PY_BUILTINS.has(name) || defined.has(name)) continue;
      out.push(`${path}:${line}: ${name}`);
    }
  }
  return out;
}

const PYTHON_FEATURES = CORPUS.filter((f) => f.backends.includes("python")).map((f) => f.id);

describe("generated python resolves every name it uses", () => {
  it("the corpus actually declares python (a zero-case sweep proves nothing)", () => {
    expect(PYTHON_FEATURES.length).toBeGreaterThan(30);
  });

  for (const id of PYTHON_FEATURES) {
    it(`${id}`, async () => {
      const files = await generateCorpusCase(id, "python");
      expect(
        unresolvedPythonNames(files),
        `names used but never imported or defined — a NameError at request time, ` +
          `invisible to compileall and to import:`,
      ).toEqual([]);
    }, 60_000);
  }
});
