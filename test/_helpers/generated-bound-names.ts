// The simple names the GENERATED backend code binds outside the model, derived
// from the emitters' own source.
//
// A domain type is refused when its name clashes with a name the generated code
// binds in the same unit (`src/util/reserved-type-names.ts`).  That table is
// only as good as its completeness, so it is checked against what the emitters
// can write, not typed from memory:
//
//   - the single-type imports, `from m import N`, `import { N } from "m"`,
//     `import N from "m"` and `alias M.N` lines the emitters spell, and the
//     names their typed import symbols (`javaRef` / `pyRef` / `tsNamed` /
//     `tsDefault` …) carry;
//   - the Java annotations the emitters write (`@Entity`, `@GetMapping`), and
//     every member of a package an emitter writes as an on-demand import (the
//     finalizer turns it into single-type imports of the members a unit names);
//   - the names the target language binds in every unit — `java.lang`, the
//     TypeScript lib and Node globals, python builtins — that the emitters'
//     source mentions at all;
//   - the names each target's generated runtime declares for itself, from the
//     symbol plan's tables (`src/generator/_symbols/runtime-names/<target>.ts`).
//     They are the only .NET names read here: the .NET units repair a clash
//     with a BCL or a generated project type by `global::` qualification and
//     the ambient aliasing, so what is left to classify on .NET is the names
//     its runtime chooses.
//
// The result over-approximates (a word in an emitter's own TypeScript counts
// too): every derived name is then either in the reserved table or in the
// admitted list `test/system/reserved-type-names.test.ts` keeps, and the
// opt-in proof (`test/e2e/reserved-type-names-proof.test.ts`) compiles every
// admitted name as a domain type on each backend.

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  JAVA_FRAMEWORK_PACKAGES,
  JAVA_LANG_TYPES,
} from "../../src/generator/_symbols/ambient-java.js";

export type BoundTarget = "node" | "java" | "python" | "elixir" | "dotnet";

const here = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(here, "..", "..");

/** The `java.lang` types, bound in every Java unit without an import, and the
 *  members of each framework package an emitter may write as an on-demand
 *  import (`import jakarta.persistence.*;`).  The import finalizer replaces
 *  such a line with a single-type import of each member the unit names, so
 *  any member can still be bound in a unit; both lists are the finalizer's own
 *  data (`src/generator/_symbols/ambient-java.ts`), and the proof re-reads
 *  `java.lang` from the JDK. */
export { JAVA_FRAMEWORK_PACKAGES, JAVA_LANG_TYPES };

/** The capitalised python builtins (`dir(builtins)`).  The proof re-reads the
 *  interpreter and fails when this list and the toolchain disagree. */
export const PYTHON_BUILTIN_TYPES: readonly string[] = [
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
  "NotADirectoryError",
  "NotImplemented",
  "NotImplementedError",
  "OSError",
  "OverflowError",
  "PendingDeprecationWarning",
  "PermissionError",
  "ProcessLookupError",
  "PythonFinalizationError",
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
];

/** Generator directories whose TypeScript literals are FRONTEND code, not the
 *  node backend's. */
const FRONTEND_DIRS = /\/(react|vue|svelte|angular|feliz|flutter|_walker|_frontend|_packs)\//;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsFiles(p));
    else if (e.name.endsWith(".ts") && !e.name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

/** The symbol plan's per-target ambient-name tables. */
const AMBIENT_DATA = /\/_symbols\/ambient-[\w-]+\.ts$/;

/** Every emitter source file, with its text. */
function emitterSources(): { file: string; text: string }[] {
  return [
    ...tsFiles(path.join(REPO_ROOT, "src", "generator")),
    ...tsFiles(path.join(REPO_ROOT, "src", "platform")),
  ].map((file) => ({ file: file.split(path.sep).join("/"), text: fs.readFileSync(file, "utf8") }));
}

/** The TypeScript lib the generated node project compiles against (its
 *  tsconfig names `target: ES2022` and no `lib`, so the default
 *  `lib.es2022.full.d.ts` and everything it references) plus `@types/node`. */
export function tsGlobalNames(): Set<string> {
  const names = new Set<string>();
  const libDir = path.join(REPO_ROOT, "node_modules", "typescript", "lib");
  const seen = new Set<string>();
  const collect = (text: string): void => {
    for (const m of text.matchAll(
      /^\s*(?:declare\s+)?(?:var|interface|type|namespace|class|const|function)\s+([A-Z]\w*)/gm,
    )) {
      names.add(m[1]!);
    }
  };
  const visit = (file: string): void => {
    if (seen.has(file) || !fs.existsSync(file)) return;
    seen.add(file);
    const text = fs.readFileSync(file, "utf8");
    collect(text);
    for (const m of text.matchAll(/\/\/\/\s*<reference\s+lib="([^"]+)"/g)) {
      visit(path.join(libDir, `lib.${m[1]!.toLowerCase()}.d.ts`));
    }
  };
  visit(path.join(libDir, "lib.es2022.full.d.ts"));
  const nodeTypes = path.join(REPO_ROOT, "node_modules", "@types", "node");
  if (fs.existsSync(nodeTypes)) {
    for (const f of fs.readdirSync(nodeTypes)) {
      if (!f.endsWith(".d.ts")) continue;
      const text = fs.readFileSync(path.join(nodeTypes, f), "utf8");
      // Only the `declare global { … }` blocks bind names in every module.
      for (const g of text.matchAll(/declare\s+global\s*\{([\s\S]*?)\n\}/g)) collect(g[1]!);
    }
  }
  return names;
}

/** name → the binders that bind it, for one target. */
export type BoundNames = Map<string, Set<string>>;

function addTo(map: BoundNames, name: string, binder: string): void {
  if (!/^[A-Z][A-Za-z0-9_]*$/.test(name)) return;
  let s = map.get(name);
  if (!s) {
    s = new Set();
    map.set(name, s);
  }
  s.add(binder);
}

/** `value_objects` / `repository-ports` → `ValueObjects` / `RepositoryPorts`. */
const pascalOf = (file: string): string =>
  file
    .split(/[_-]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("");

/** Spell a module path written with template holes as `<project>.…`. */
const modulePath = (raw: string): string => raw.replace(/\$\{[^}]*\}/g, "<project>");

/** Every package (no template hole) a Java emitter writes as an on-demand
 *  import — each must be one the finalizer expands, its members listed in
 *  {@link JAVA_FRAMEWORK_PACKAGES}. */
export function javaOnDemandImports(): string[] {
  const pkgs = new Set<string>();
  for (const { text } of emitterSources()) {
    for (const m of text.matchAll(/\bimport\s+([a-z][\w.]*)\.\*\s*;/g)) pkgs.add(m[1]!);
  }
  return [...pkgs].sort();
}

/** Derive, per backend target, every simple type-like name the generated code
 *  can bind outside the model. */
export function deriveBoundNames(): Record<BoundTarget, BoundNames> {
  const out: Record<BoundTarget, BoundNames> = {
    node: new Map(),
    java: new Map(),
    python: new Map(),
    elixir: new Map(),
    dotnet: new Map(),
  };
  const sources = emitterSources();
  const words = new Map<BoundTarget, Set<string>>();
  const wordsOf = (t: BoundTarget, text: string): void => {
    let s = words.get(t);
    if (!s) {
      s = new Set();
      words.set(t, s);
    }
    for (const m of text.matchAll(/\b[A-Z][A-Za-z0-9_]*\b/g)) s.add(m[0]);
  };
  for (const { file, text } of sources) {
    // The symbol plan's ambient tables list every name a target's language
    // scope holds; they are data about the target, not names an emitter writes.
    const mentions = AMBIENT_DATA.test(file) ? "" : text;
    // Java — a single-type import line, a typed symbol, an annotation.
    for (const m of text.matchAll(/\bimport\s+(?!static\b)([\w.${}()]+?)\.([A-Z]\w*)\s*;/g)) {
      addTo(out.java, m[2]!, `${modulePath(m[1]!)}.${m[2]}`);
    }
    for (const m of text.matchAll(/\bjava(?:Ref|Type|OnDemandRef)\(\s*"([\w.]+)",\s*"(\w+)"/g)) {
      addTo(out.java, m[2]!, `${m[1]}.${m[2]}`);
    }
    for (const m of text.matchAll(/\bimport\s+([a-z][\w.]*)\.\*\s*;/g)) {
      const members = JAVA_FRAMEWORK_PACKAGES[m[1]!];
      if (members) for (const n of members) addTo(out.java, n, `${m[1]}.${n}`);
    }
    if (file.includes("/generator/java/") || /java/i.test(path.basename(file))) {
      wordsOf("java", mentions);
      for (const m of text.matchAll(
        /[`"'](?:[^`"'\n]*?\s)?(?:class|interface|record|enum|@interface)\s+([A-Z]\w*)\b/g,
      )) {
        addTo(out.java, m[1]!, `<project>.${m[1]} (generated)`);
      }
      for (const m of text.matchAll(/[`"'(\s]@([A-Z]\w*)\b/g)) {
        addTo(out.java, m[1]!, `@${m[1]} (annotation)`);
      }
    }
    // Python — `from m import A, B` (also parenthesised), typed symbols.
    for (const m of text.matchAll(
      /\bfrom\s+([\w.${}]+)\s+import\s+\(?([\w\s,]+?)\)?\s*(?:["'`\n]|$)/g,
    )) {
      for (const part of m[2]!.split(",")) {
        const [name, alias] = part.trim().split(/\s+as\s+/);
        if (name) addTo(out.python, (alias ?? name).trim(), `${modulePath(m[1]!)}.${name.trim()}`);
      }
    }
    for (const m of text.matchAll(/\bpy(?:Ref|From)\(\s*"([\w.]+)",\s*"(\w+)"(?:,\s*"(\w+)")?/g)) {
      addTo(out.python, m[3] ?? m[2]!, `${m[1]}.${m[2]}`);
    }
    if (file.includes("/generator/python/") || /python/i.test(path.basename(file))) {
      wordsOf("python", mentions);
      for (const m of text.matchAll(/(?:[`"']\s*|^)class\s+([A-Z]\w*)\b/gm)) {
        addTo(out.python, m[1]!, `app.${m[1]} (generated)`);
      }
      // A generated domain module: an aggregate of that name would be
      // written to the same file (`Errors` → `app/domain/errors.py`).
      for (const m of text.matchAll(/\bapp\/domain\/([a-z][a-z_]*)\.py\b/g)) {
        addTo(out.python, pascalOf(m[1]!), `app/domain/${m[1]}.py (generated module)`);
      }
    }
    if (file.includes("/generator/elixir/") || /elixir|phoenix/i.test(path.basename(file))) {
      for (const m of text.matchAll(/defmodule\s+[\w.#{}$]*?\.?([A-Z]\w*)\s+do\b/g)) {
        addTo(out.elixir, m[1]!, `<app>.${m[1]} (generated)`);
      }
    }
    // Elixir — `alias A.B.C`, `alias A.B.{C, D}`, `alias A.B, as: C`.
    for (const m of text.matchAll(/\balias\s+([A-Z][\w.]*?)\.\{([\w\s,]+)\}/g)) {
      for (const part of m[2]!.split(",")) {
        addTo(out.elixir, part.trim(), `${m[1]}.${part.trim()}`);
      }
    }
    for (const m of text.matchAll(
      /\balias\s+((?:[A-Z]\w*|#\{[^}]*\}|\$\{[^}]*\})(?:\.(?:[A-Z]\w*|#\{[^}]*\}|\$\{[^}]*\}))*)(?:,\s*as:\s*([A-Z]\w*))?/g,
    )) {
      const full = m[1]!;
      const last = m[2] ?? full.split(".").pop()!;
      addTo(out.elixir, last, modulePath(full));
    }
    // Node — named imports the node backend's emitters write.
    if (!FRONTEND_DIRS.test(file)) {
      for (const m of text.matchAll(
        /[`"']import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g,
      )) {
        for (const raw of m[1]!.split(",")) {
          const s = raw.trim().replace(/^type\s+/, "");
          const local = s.includes(" as ") ? s.split(/\s+as\s+/)[1]!.trim() : s;
          addTo(out.node, local, `${modulePath(m[2]!)}#${s.split(/\s+as\s+/)[0]}`);
        }
      }
      for (const m of text.matchAll(/\btsNamed\(\s*"([^"]+)",\s*"(\w+)"(?:,\s*"(\w+)")?/g)) {
        addTo(out.node, m[3] ?? m[2]!, `${m[1]}#${m[2]}`);
      }
      // Default imports, hand-written and as typed symbols (`tsDefault`).
      for (const m of text.matchAll(
        /[`"']import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\}\s*)?from\s*["']([^"']+)["']/g,
      )) {
        addTo(out.node, m[1]!, `${modulePath(m[2]!)}#default`);
      }
      for (const m of text.matchAll(/\btsDefault\(\s*"([^"]+)",\s*"(\w+)"/g)) {
        addTo(out.node, m[2]!, `${m[1]}#default`);
      }
      if (
        file.includes("/generator/typescript/") ||
        file.includes("/platform/hono/") ||
        /hono|\bts\b/i.test(path.basename(file))
      ) {
        wordsOf("node", mentions);
        // Generated declarations: quoted lines, and the multi-line template
        // bodies whose lines start `export class` (a node emitter's own source
        // exports functions and constants, never classes; another target's
        // emitter source may export a compiler-side class, which is not emitted).
        for (const m of text.matchAll(
          /[`"']\s*export\s+(?:abstract\s+|declare\s+)*(?:class|interface|type|enum|const)\s+([A-Z]\w*)\b/g,
        )) {
          addTo(out.node, m[1]!, `<project>/${m[1]} (generated)`);
        }
        const otherTarget = /\/generator\/(?:java|python|elixir|dotnet)\//.test(file);
        for (const m of otherTarget
          ? []
          : text.matchAll(/^export\s+(?:abstract\s+)?class\s+([A-Z]\w*)\b/gm)) {
          addTo(out.node, m[1]!, `<project>/${m[1]} (generated)`);
        }
        for (const m of text.matchAll(/[`"']domain\/([a-z][a-z-]*)\.ts[`"']/g)) {
          addTo(out.node, pascalOf(m[1]!), `domain/${m[1]}.ts (generated module)`);
        }
      }
    }
  }
  // The language-level names, as far as the emitters mention them.
  const javaWords = words.get("java") ?? new Set();
  for (const n of JAVA_LANG_TYPES) if (javaWords.has(n)) addTo(out.java, n, `java.lang.${n}`);
  const pyWords = words.get("python") ?? new Set();
  for (const n of PYTHON_BUILTIN_TYPES) if (pyWords.has(n)) addTo(out.python, n, `builtins.${n}`);
  const nodeWords = words.get("node") ?? new Set();
  for (const n of tsGlobalNames()) if (nodeWords.has(n)) addTo(out.node, n, `global ${n}`);
  // The runtime's own names, from the symbol plan.
  const runtimeDir = path.join(REPO_ROOT, "src", "generator", "_symbols", "runtime-names");
  const runtimeTarget: Readonly<Record<string, BoundTarget>> = {
    "ts.ts": "node",
    "java.ts": "java",
    "python.ts": "python",
    "elixir.ts": "elixir",
    "dotnet.ts": "dotnet",
  };
  for (const f of fs.readdirSync(runtimeDir)) {
    const target = runtimeTarget[f];
    if (!target) throw new Error(`runtime-names/${f}: map it to a bound target`);
    const text = fs.readFileSync(path.join(runtimeDir, f), "utf8");
    for (const m of text.matchAll(/"([A-Z][A-Za-z0-9_]*)"/g)) {
      addTo(out[target], m[1]!, `${m[1]} (runtime name, runtime-names/${f})`);
    }
  }
  return out;
}
