// The BINDING floor for emitted TypeScript: every symbol an emitted file names
// must be one it imports, declares, or gets from the platform.
//
// ---------------------------------------------------------------------------
// WHY A BINDER, AND NOT A CHEAPER CHECK
// ---------------------------------------------------------------------------
//
// The recurring defect this exists for is a file that spells a symbol its
// import header does not carry:
//
//     .where(ne(schema.tickets.status, "Closed"))
//     import { and, asc, count, desc, eq, inArray } from "drizzle-orm";  // no `ne`
//
//     weight: moneySchema.default(new Decimal("0.00")),                 // no decimal.js
//
// Both emitted from `ddd generate system` reporting `0 error(s), 0 warning(s)`,
// and both fatal at `tsc --noEmit` (`TS2304: Cannot find name`).  Neither is
// reachable by the two cheaper oracles already in the tree:
//
//   - A TEXT assertion needs to know the bad string in advance.  The whole
//     shape of this class is that nobody knew: `ne` is one of six comparison
//     spellings, `Decimal` follows from a modifier (`money = money("0.00")`)
//     nobody connected to the import header.  You cannot grep for a symbol
//     whose absence is the bug.
//
//   - A PARSE gate (`test/generator/_packs/tsx-parse-gate.test.ts`) runs the
//     scanner and parser only.  `ne(x, y)` is perfectly well-formed TypeScript;
//     an undefined identifier is a BINDER fact, one layer above syntax.  That
//     gate is the right floor for its own class (a pack template emitting
//     `{{{`), and it is structurally blind to this one.
//
// So this runs the real thing — `ts.createProgram` over the emitted files — and
// reads back only the binder-level diagnostics.  What makes that affordable in
// the fast tier is that it needs NO `node_modules` for the generated project,
// no `npm install` and no network: an unresolvable module specifier still
// DECLARES its imported names (TypeScript reports `TS2307` for the module and
// types the bindings as `any`), so `import { eq } from "drizzle-orm"` puts `eq`
// in scope whether or not drizzle is on disk.  A name that is never imported at
// all has nothing to be typed as, and that is exactly the defect.
//
// ---------------------------------------------------------------------------
// WHY THE FILTER IS SOUND
// ---------------------------------------------------------------------------
//
// Only `CHECKED_CODES` below are read; every TYPE-level diagnostic is dropped,
// because without the real dependency types they would be noise (`any`
// everywhere) and the compile tiers own that question anyway.  The codes kept
// are all decided by the BINDER, from the file's own declarations plus lib —
// which is the half that is complete here:
//
//   2304  Cannot find name 'x'                       — the defect class
//   2552  Cannot find name 'x'. Did you mean 'y'?    — the same, with a suggestion
//   2503  Cannot find namespace 'N'                  — its type-position twin
//   2300  Duplicate identifier                       — the over-import mirror
//   2440  Import declaration conflicts with a local declaration
//   2451  Cannot redeclare block-scoped variable
//
// The last three matter because the fix for an under-import is an emitter that
// adds imports, and the failure mode of THAT is an import colliding with a
// local declaration — a gate that only catches one direction would push the
// bug sideways rather than closing it.
//
// `@types/node` is supplied from the TOOLCHAIN's own `node_modules` (already
// installed; nothing is fetched), because `process`, `Buffer` and friends are
// genuinely in scope in the generated project and reporting them would be a
// false positive.
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** Binder-level diagnostics — see the header for why exactly these. */
const CHECKED_CODES = new Set([2304, 2552, 2503, 2300, 2440, 2451]);

/** A directory outside any real tree, so TypeScript's node resolution cannot
 *  wander up into the toolchain's own `node_modules` and accidentally resolve a
 *  generated project's dependency. */
const VROOT = "/__loom_emitted__";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface UnboundSymbol {
  file: string;
  line: number;
  column: number;
  code: number;
  message: string;
}

/**
 * Which top-level project directories in an emitted system are Hono backends.
 *
 * Read off the emitted `package.json` rather than from a hard-coded deployable
 * name, so a model that names its backend anything at all is still covered.
 */
export function honoProjectDirs(files: ReadonlyMap<string, string>): string[] {
  const dirs: string[] = [];
  for (const [p, content] of files) {
    if (!p.endsWith("package.json")) continue;
    const dir = path.posix.dirname(p);
    if (dir.includes("/")) continue; // top-level project dirs only
    try {
      const pkg = JSON.parse(content) as { dependencies?: Record<string, string> };
      if (pkg.dependencies?.hono) dirs.push(dir);
    } catch {
      // A package.json this gate cannot parse is not this gate's business.
    }
  }
  return dirs.sort();
}

/**
 * Every symbol an emitted `.ts` file names without binding it (and the mirror
 * case: a symbol bound twice).
 *
 * `files` is a whole `generateSystemFiles` emission; `projectDir` selects one
 * project inside it, so the program sees exactly the module graph the generated
 * project's own `tsc` would.
 */
export function unboundSymbols(
  files: ReadonlyMap<string, string>,
  projectDir: string,
): UnboundSymbol[] {
  const virtual = new Map<string, string>();
  for (const [p, content] of files) {
    if (!p.startsWith(`${projectDir}/`)) continue;
    if (!p.endsWith(".ts") || p.endsWith(".d.ts")) continue;
    virtual.set(`${VROOT}/${p.slice(projectDir.length + 1)}`, content);
  }
  if (virtual.size === 0) {
    throw new Error(
      `no .ts files emitted under "${projectDir}" — the probe is stale, not the emitter`,
    );
  }

  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    // Type-level strictness is deliberately off: without the real dependency
    // types every inference is `any`, so a strict run would report noise the
    // binder codes above are immune to.
    strict: false,
    noEmit: true,
    skipLibCheck: true,
    allowJs: false,
    // Node globals ARE in scope in the generated project; supplied from the
    // toolchain's own already-installed types so nothing is fetched.
    types: ["node"],
    typeRoots: [path.join(REPO_ROOT, "node_modules", "@types")],
    lib: ["lib.esnext.d.ts", "lib.dom.d.ts"],
  };

  const sourceFiles = new Map<string, ts.SourceFile>();
  const host: ts.CompilerHost = {
    getSourceFile(fileName, languageVersion) {
      const cached = sourceFiles.get(fileName);
      if (cached) return cached;
      const text =
        virtual.get(fileName) ??
        (ts.sys.fileExists(fileName) ? ts.sys.readFile(fileName) : undefined);
      if (text === undefined) return undefined;
      const sf = ts.createSourceFile(fileName, text, languageVersion, true, ts.ScriptKind.TS);
      sourceFiles.set(fileName, sf);
      return sf;
    },
    getDefaultLibFileName: (o) => ts.getDefaultLibFilePath(o),
    writeFile: () => {
      /* noEmit */
    },
    getCurrentDirectory: () => VROOT,
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => "\n",
    fileExists: (f) => virtual.has(f) || ts.sys.fileExists(f),
    readFile: (f) => virtual.get(f) ?? ts.sys.readFile(f),
    directoryExists: (d) => d.startsWith(VROOT) || ts.sys.directoryExists(d),
    getDirectories: (d) => (d.startsWith(VROOT) ? [] : (ts.sys.getDirectories(d) ?? [])),
  };

  const program = ts.createProgram([...virtual.keys()].sort(), options, host);
  const found: UnboundSymbol[] = [];
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || !virtual.has(sf.fileName)) continue;
    for (const d of program.getSemanticDiagnostics(sf)) {
      if (!CHECKED_CODES.has(d.code)) continue;
      const at = d.start != null ? sf.getLineAndCharacterOfPosition(d.start) : undefined;
      found.push({
        file: sf.fileName.slice(VROOT.length + 1),
        line: at ? at.line + 1 : 0,
        column: at ? at.character + 1 : 0,
        code: d.code,
        message: ts.flattenDiagnosticMessageText(d.messageText, " "),
      });
    }
  }
  return found;
}

/** One-line-per-finding rendering for an assertion message. */
export function formatUnbound(found: readonly UnboundSymbol[]): string {
  return found
    .map((f) => `  ${f.file}(${f.line},${f.column}): TS${f.code}: ${f.message}`)
    .join("\n");
}

/** Sanity: the toolchain's `@types/node` must actually be on disk, or every
 *  `process.env` in the emitted project reads as a defect. */
export function assertNodeTypesAvailable(): void {
  const p = path.join(REPO_ROOT, "node_modules", "@types", "node", "package.json");
  if (!fs.existsSync(p)) {
    throw new Error(
      `@types/node not found at ${p} — this gate supplies node globals from the ` +
        `toolchain's own install; without it the emitted project's \`process.env\` ` +
        `reads as an unbound symbol and the gate is all false positives.`,
    );
  }
}
