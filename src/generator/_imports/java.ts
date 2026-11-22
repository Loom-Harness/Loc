// ---------------------------------------------------------------------------
// Imports derived from use — Java.  Symbol constructors and the
// compilation-unit finalizer: resolves `ref()` markers, merges the unit's
// remaining hand-written imports with the referenced types, and renders ONE
// import block in the google-java-format order:
//
//   static imports first (ASCII order), a blank line, then every other import
//   in ASCII order as one block; duplicates collapse.
//
// A generated unit imports every type by its single name, never on demand: an
// on-demand import (`import <pkg>.*;`) binds every type of the package, so a
// domain type sharing a simple name with any of them breaks the unit even when
// the unit never names the framework type.  An emitter may still WRITE
// `import <pkg>.*;` for a framework package listed in
// `JAVA_FRAMEWORK_PACKAGES` or a package of the generated project: the
// finalizer replaces it with a single-type import of each of that package's
// types the unit's code names, and refuses any other.
//
// A referenced type needs NO line when it lives in the unit's own package or
// in `java.lang`.  Java has no import aliasing, so two framework types sharing
// a simple name is a thrown error — spell one fully qualified instead.  A
// DOMAIN type (`javaProjectRef`) never collides: where its simple name is
// taken (`javaAmbientClash`, the symbol plan), it is spelled fully qualified.
// ---------------------------------------------------------------------------

import {
  JAVA_FRAMEWORK_PACKAGES,
  JAVA_FRAMEWORK_STATIC_MEMBERS,
} from "../_symbols/ambient-java.js";
import { isJavaLangTypeName, javaAmbientClash } from "../_symbols/plan.js";
import { type ImportSymbol, ref, resolveMarkers, spelling } from "./symbol.js";

/** `import <pkg>.<Name>;` — a type (or nested type's outer class). */
export function javaType(pkg: string, name: string): ImportSymbol {
  return { lang: "java", module: pkg, name };
}

/** Shorthand: the marker for `import <pkg>.<Name>;`. */
export function javaRef(pkg: string, name: string): string {
  return ref(javaType(pkg, name));
}

/** The module a {@link javaProjectRef} marker carries: the declaring package
 *  is looked up in the project's type index when the unit is finalized. */
const PROJECT_MODULE = "loom.project";

/** A reference to a type the generated project declares (a domain type), by
 *  its simple name.  The finalizer finds its package in the project's type
 *  index and spells it bare with a single-type import — or fully qualified
 *  where the symbol plan says the simple name is taken in that unit. */
export function javaProjectRef(name: string): string {
  return ref({ lang: "java", module: PROJECT_MODULE, name });
}

/** The line a unit places where its import block goes when it has no
 *  hand-written import left (replaced by the derived block, or removed). */
export const JAVA_IMPORTS = "java-imports";

const IMPORT_RE = /^import\s+(static\s+)?([\w.]+(?:\.\*)?)\s*;\s*$/;
const PACKAGE_RE = /^package\s+([\w.]+)\s*;/m;
/** A type declaration's name (top-level or nested). */
const DECL_RE = /(?:^|[\s;{}])(?:class|interface|enum|record|@interface)\s+([A-Za-z_$][\w$]*)/g;
/** A top-level type declaration: unindented, after optional modifiers. */
const TOP_DECL_RE =
  /^(?:(?:public|final|abstract|sealed|non-sealed|strictfp)\s+)*(?:class|interface|enum|record|@interface)\s+([A-Za-z_$][\w$]*)/gm;

// ---------------------------------------------------------------------------
// The project's type index
// ---------------------------------------------------------------------------

/** The top-level types a generated Java project declares, by package. */
export interface JavaProjectIndex {
  readonly packages: ReadonlyMap<string, ReadonlySet<string>>;
  /** Simple name → every package declaring a top-level type of that name. */
  readonly byName: ReadonlyMap<string, readonly string[]>;
}

/** Index the top-level types of every `.java` unit in `files`. */
export function indexJavaProject(files: Iterable<readonly [string, string]>): JavaProjectIndex {
  const packages = new Map<string, Set<string>>();
  const byName = new Map<string, string[]>();
  for (const [path, text] of files) {
    if (!path.endsWith(".java")) continue;
    const pkg = PACKAGE_RE.exec(text)?.[1];
    if (pkg === undefined) continue;
    const names = packages.get(pkg) ?? new Set<string>();
    packages.set(pkg, names);
    for (const m of text.matchAll(TOP_DECL_RE)) {
      const n = m[1]!;
      if (names.has(n)) continue;
      names.add(n);
      byName.set(n, [...(byName.get(n) ?? []), pkg]);
    }
  }
  return { packages, byName };
}

const EMPTY_INDEX: JavaProjectIndex = { packages: new Map(), byName: new Map() };

// ---------------------------------------------------------------------------
// The simple names a unit's code spells
// ---------------------------------------------------------------------------

/** Every identifier the code names unqualified — not after a `.`, and not
 *  inside a comment, string, text block or char literal.  These are the
 *  simple names an import may have to bind. */
export function javaSimpleNames(code: string): Set<string> {
  const out = new Set<string>();
  const n = code.length;
  let i = 0;
  let prevSignificant = "";
  while (i < n) {
    const c = code[i]!;
    if (c === "/" && code[i + 1] === "/") {
      const e = code.indexOf("\n", i);
      i = e < 0 ? n : e;
      continue;
    }
    if (c === "/" && code[i + 1] === "*") {
      const e = code.indexOf("*/", i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (c === '"' && code.startsWith('"""', i)) {
      let j = i + 3;
      while (j < n && !code.startsWith('"""', j)) j += code[j] === "\\" ? 2 : 1;
      i = j + 3;
      prevSignificant = '"';
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && code[j] !== c && code[j] !== "\n") j += code[j] === "\\" ? 2 : 1;
      i = j + 1;
      prevSignificant = c;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(code[j]!)) j++;
      if (prevSignificant !== ".") out.add(code.slice(i, j));
      prevSignificant = "a";
      i = j;
      continue;
    }
    if (/\d/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(code[j]!)) j++;
      i = j;
      prevSignificant = "0";
      continue;
    }
    if (!/\s/.test(c)) prevSignificant = c;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The finalizer
// ---------------------------------------------------------------------------

interface Region {
  readonly start: number;
  readonly end: number;
  readonly statics: string[];
  readonly plain: string[];
}

/** The unit's leading import region: after the `package` line (and any
 *  blank / comment lines), every contiguous import / blank / slot line. */
function leadingRegion(lines: readonly string[]): Region | null {
  let i = 0;
  while (i < lines.length && !/^package\s/.test(lines[i]!)) {
    if (/^import\s|^java-imports/.test(lines[i]!)) break;
    i++;
  }
  if (i < lines.length && /^package\s/.test(lines[i]!)) i++;
  while (
    i < lines.length &&
    (lines[i]!.trim() === "" || /^\s*(\/\/|\/\*|\*)/.test(lines[i]!)) &&
    !lines[i]!.startsWith(JAVA_IMPORTS)
  ) {
    i++;
  }
  const start = i;
  let end = i;
  const statics: string[] = [];
  const plain: string[] = [];
  let any = false;
  while (i < lines.length) {
    const l = lines[i]!;
    if (l === JAVA_IMPORTS) {
      any = true;
      i++;
      end = i;
      continue;
    }
    if (l.trim() === "") {
      i++;
      continue;
    }
    const m = IMPORT_RE.exec(l);
    if (!m) break;
    (m[1] ? statics : plain).push(m[2]!);
    any = true;
    i++;
    end = i;
  }
  return any ? { start, end, statics, plain } : null;
}

const ascii = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const simpleOf = (fq: string): string => fq.slice(fq.lastIndexOf(".") + 1);
const pkgOf = (fq: string): string => fq.slice(0, fq.lastIndexOf("."));

/** A placeholder for a project reference while the unit's imports are
 *  settled; not an identifier, so the simple-name scan skips it. */
const HOLD_OPEN = "";
const HOLD_CLOSE = "";
const HOLD_RE = /([\w$]+)/g;

export interface FinalizeJavaOptions {
  readonly path?: string;
  /** The generated project's types — resolves project references and the
   *  project's own on-demand imports. */
  readonly index?: JavaProjectIndex;
}

/**
 * Finalize one Java compilation unit: spell every `ref()` marker, replace each
 * on-demand import with the single-type imports the unit's code needs, and
 * replace its leading import region (remaining hand-written imports and/or the
 * `JAVA_IMPORTS` slot) with the canonical block.  A unit with neither a marker
 * nor an import comes back unchanged.
 */
export function finalizeJavaUnit(text: string, opts: FinalizeJavaOptions = {}): string {
  const where = opts.path ?? "<java unit>";
  const index = opts.index ?? EMPTY_INDEX;
  const own = PACKAGE_RE.exec(text)?.[1];
  // The simple names the unit itself owns: the types it declares and the
  // types of its own package.  A single-type import of another type of that
  // name would take it from them, so a framework reference that collides is
  // spelled fully qualified instead.
  const declared = new Set([...text.matchAll(DECL_RE)].map((m) => m[1]!));
  const ownTypes = own === undefined ? new Set<string>() : (index.packages.get(own) ?? new Set());
  const local = new Set([...declared, ...ownTypes]);
  const yields = (s: ImportSymbol): boolean =>
    s.module !== PROJECT_MODULE && s.module !== own && local.has(s.name!);
  const { text: spelled, used } = resolveMarkers(
    text,
    (s) => s.module === own || s.module === "java.lang",
    (s) =>
      s.module === PROJECT_MODULE
        ? `${HOLD_OPEN}${s.name}${HOLD_CLOSE}`
        : yields(s)
          ? `${s.module}.${s.name}`
          : spelling(s),
  );
  const framework = used.filter((s) => s.module !== PROJECT_MODULE && !yields(s));
  const projectRefs = used.filter((s) => s.module === PROJECT_MODULE).map((s) => s.name!);
  const lines = spelled.split("\n");
  let region = leadingRegion(lines);
  // A unit with no import region that references only project types gets one
  // after its `package` line, should any of them need an import.
  const synthesized = region === null && framework.length === 0 && projectRefs.length > 0;
  if (region === null) {
    const pkgLine = lines.findIndex((l) => /^package\s/.test(l));
    if (!synthesized || pkgLine < 0) {
      if (used.length > 0) {
        throw new Error(
          `${where}: references ${used.map(spelling).join(", ")} but has no import region (add a JAVA_IMPORTS slot)`,
        );
      }
      return spelled;
    }
    region = { start: pkgLine + 1, end: pkgLine + 1, statics: [], plain: [] };
  }
  if (lines.slice(region.end).includes(JAVA_IMPORTS)) {
    throw new Error(`${where}: the JAVA_IMPORTS slot must sit in the leading region`);
  }

  const before = lines.slice(0, region.start);
  let after = lines.slice(region.end);
  const code = after.join("\n");
  const names = javaSimpleNames(code);

  // Single-type imports: simple name → fully-qualified name.
  const bound = new Map<string, string>();
  const bind = (fq: string): void => {
    const name = simpleOf(fq);
    const prior = bound.get(name);
    if (prior !== undefined && prior !== fq) {
      throw new Error(
        `${where}: two imports bind '${name}' (${prior} and ${fq}) — spell one fully qualified`,
      );
    }
    bound.set(name, fq);
  };
  const onDemand: string[] = [];
  for (const p of region.plain) {
    if (p.endsWith(".*")) onDemand.push(p.slice(0, -2));
    else bound.set(simpleOf(p), p);
  }
  for (const s of framework) bind(`${s.module}.${s.name}`);

  // Framework packages imported on demand: the listed types the code names.
  const projectOnDemand: string[] = [];
  for (const pkg of onDemand) {
    const members = JAVA_FRAMEWORK_PACKAGES[pkg];
    if (members === undefined) {
      projectOnDemand.push(pkg);
      continue;
    }
    for (const n of members) {
      if (names.has(n) && !bound.has(n) && !local.has(n)) bound.set(n, `${pkg}.${n}`);
    }
  }

  // Project references: bare with an import, or fully qualified where the
  // simple name is taken in this unit.
  const projectPkg = (name: string): string | undefined => {
    if (ownTypes.has(name)) return own;
    const cands = index.byName.get(name) ?? [];
    if (cands.length === 1) return cands[0];
    const viaOnDemand = cands.filter((p) => projectOnDemand.includes(p));
    return viaOnDemand.length === 1 ? viaOnDemand[0] : undefined;
  };
  const qualified = new Set<string>();
  for (const name of new Set(projectRefs)) {
    const pkg = projectPkg(name);
    if (pkg === undefined) {
      // Not (uniquely) declared by the project: spelled as written, and
      // imported, like any other name the code spells, by an on-demand import.
      names.add(name);
      continue;
    }
    const fq = `${pkg}.${name}`;
    if (javaAmbientClash(name, fq, bound) || (local.has(name) && pkg !== own)) {
      qualified.add(name);
    } else if (pkg !== own) {
      bound.set(name, fq);
    }
  }
  const spell = (l: string): string =>
    l.replace(HOLD_RE, (_m, name: string) =>
      qualified.has(name) ? `${projectPkg(name)}.${name}` : name,
    );
  after = after.map(spell);
  const head = before.map(spell);

  // The project's own packages imported on demand: the types the code names
  // that no single-type import, own-package type, nested type or `java.lang`
  // type already binds (each of those would win over the on-demand import).
  // A name two such packages declare stays unimported, as it was ambiguous.
  const provider = new Map<string, string | null>();
  for (const pkg of projectOnDemand) {
    const members = index.packages.get(pkg);
    if (members === undefined && !(own !== undefined && sameProject(pkg, own))) {
      throw new Error(
        `${where}: imports '${pkg}.*' on demand, which is neither a project package nor a listed framework package (JAVA_FRAMEWORK_PACKAGES)`,
      );
    }
    for (const n of members ?? []) {
      if (!names.has(n) || bound.has(n) || declared.has(n) || ownTypes.has(n)) continue;
      if (isJavaLangTypeName(n)) continue;
      provider.set(n, provider.has(n) ? null : pkg);
    }
  }
  for (const [n, pkg] of provider) if (pkg !== null) bound.set(n, `${pkg}.${n}`);

  // Static on-demand imports: the listed members the code names.
  const statics = new Set<string>();
  for (const s of region.statics) {
    if (!s.endsWith(".*")) {
      statics.add(s);
      continue;
    }
    const cls = s.slice(0, -2);
    const members = JAVA_FRAMEWORK_STATIC_MEMBERS[cls];
    if (members === undefined) {
      throw new Error(
        `${where}: imports '${s}' on demand, which is not a listed class (JAVA_FRAMEWORK_STATIC_MEMBERS)`,
      );
    }
    for (const m of members) if (names.has(m)) statics.add(`${cls}.${m}`);
  }

  const plain = [...new Set(bound.values())].filter(
    (fq) => pkgOf(fq) !== own && pkgOf(fq) !== "java.lang",
  );
  const staticLines = [...statics].sort(ascii);
  const rest = plain.sort(ascii);
  const block = [
    ...(synthesized && staticLines.length + rest.length > 0 ? [""] : []),
    ...staticLines.map((s) => `import static ${s};`),
    ...(staticLines.length > 0 && rest.length > 0 ? [""] : []),
    ...rest.map((p) => `import ${p};`),
  ];
  let blanks = 0;
  while (blanks < after.length && after[blanks]!.trim() === "") blanks++;
  if (block.length === 0) {
    if (synthesized || blanks === after.length) return [...head, ...after].join("\n");
    // No import left: exactly one blank line after the `package` line.
    const sep = head.length > 0 && head[head.length - 1]!.trim() === "" ? [] : [""];
    return [...head, ...sep, ...after.slice(blanks)].join("\n");
  }
  // Exactly one blank line between the block and the declarations.
  after = after.length === blanks ? after : ["", ...after.slice(blanks)];
  return [...head, ...block, ...after].join("\n");
}

/** Two packages of one generated project (`com.loom.<deployable>…`). */
function sameProject(a: string, b: string): boolean {
  const root = (p: string): string => p.split(".").slice(0, 3).join(".");
  return root(a) === root(b);
}
