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
// A `javaRef` into one of the project's own packages is a project reference
// too, with its package known.
//
// The emitters' convention: a type they spell BARE is the platform's
// (`String`, `List`, `GetMapping`, the runtime `Paged`); a type they mean as
// the project's goes through a project reference.  So where a type of the
// unit's own (declared in it, in its package, or — for `java.lang` — either)
// takes a platform name the code spells bare, every bare use is spelled fully
// qualified (`java.lang.String`), and an import the unit cannot keep (a type
// it declares of that name) is dropped for the same spelling.  A unit with no
// such collision is untouched.
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

/** The package (below the project's base package) each declared domain-type
 *  kind lives in — what settles a domain type whose simple name a generated
 *  runtime type shares (a value object `DomainException`). */
const DOMAIN_KIND_PACKAGE = {
  enum: "domain.enums",
  valueobject: "domain.valueobjects",
  event: "domain.events",
  id: "domain.ids",
} as const;

/** A reference to a type the generated project declares (a domain type), by
 *  its simple name.  The finalizer finds its package in the project's type
 *  index and spells it bare with a single-type import — or fully qualified
 *  where the symbol plan says the simple name is taken in that unit.  `kind`
 *  names the domain package an enum, event or value object lives in, for a
 *  simple name more than one package declares. */
export function javaProjectRef(name: string, kind?: keyof typeof DOMAIN_KIND_PACKAGE): string {
  const module =
    kind === undefined ? PROJECT_MODULE : `${PROJECT_MODULE}.${DOMAIN_KIND_PACKAGE[kind]}`;
  return ref({ lang: "java", module, name });
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

/** One identifier the scan meets in code position. */
interface JavaIdent {
  readonly start: number;
  readonly end: number;
  /** The last significant character before it (`.` for a qualified name). */
  readonly prev: string;
  /** The identifier token before it, when the last significant token was one. */
  readonly prevWord: string;
}

/** Visit every identifier of the code that sits outside a comment, string,
 *  text block or char literal. */
function scanJavaIdents(code: string, visit: (id: JavaIdent) => void): void {
  const n = code.length;
  let i = 0;
  let prevSignificant = "";
  let prevWord = "";
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
      prevWord = "";
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && code[j] !== c && code[j] !== "\n") j += code[j] === "\\" ? 2 : 1;
      i = j + 1;
      prevSignificant = c;
      prevWord = "";
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w$]/.test(code[j]!)) j++;
      const word = code.slice(i, j);
      visit({ start: i, end: j, prev: prevSignificant, prevWord });
      prevSignificant = "a";
      prevWord = word;
      i = j;
      continue;
    }
    if (/\d/.test(c)) {
      let j = i + 1;
      while (j < n && /[\w.]/.test(code[j]!)) j++;
      i = j;
      prevSignificant = "0";
      prevWord = "";
      continue;
    }
    if (!/\s/.test(c)) {
      prevSignificant = c;
      prevWord = "";
    }
    i++;
  }
}

/** Every identifier the code names unqualified — not after a `.`, and not
 *  inside a comment, string, text block or char literal.  These are the
 *  simple names an import may have to bind. */
export function javaSimpleNames(code: string): Set<string> {
  const out = new Set<string>();
  scanJavaIdents(code, (id) => {
    if (id.prev !== ".") out.add(code.slice(id.start, id.end));
  });
  return out;
}

/** The simple names the code spells BARE — unqualified and not a project
 *  reference the finalizer holds for spelling. */
function bareSimpleNames(code: string): Set<string> {
  const out = new Set<string>();
  scanJavaIdents(code, (id) => {
    if (id.prev !== "." && id.prev !== HOLD_OPEN) out.add(code.slice(id.start, id.end));
  });
  return out;
}

const MEMBER_MODIFIERS = new Set(["public", "protected", "private"]);
const DECL_KEYWORDS = new Set(["class", "interface", "enum", "record"]);

/**
 * Spell every bare use of a name in `qualify` by its fully-qualified name —
 * the bare names the emitters write for a platform type (`String`, `List`,
 * `GetMapping`) where a generated type of the unit's own takes that simple
 * name.  A project reference is held, not bare, so it never moves.  The
 * unit's own declarations keep their name: a type declaration
 * (`record String(…)`) and a constructor of a type the unit declares
 * (`public String(…)`, the compact `public String {`).
 */
function qualifyBare(
  code: string,
  qualify: ReadonlyMap<string, string>,
  declared: ReadonlySet<string>,
): string {
  if (qualify.size === 0) return code;
  const edits: { start: number; end: number; text: string }[] = [];
  scanJavaIdents(code, (id) => {
    if (id.prev === "." || id.prev === HOLD_OPEN) return;
    const name = code.slice(id.start, id.end);
    const fq = qualify.get(name);
    if (fq === undefined) return;
    if (DECL_KEYWORDS.has(id.prevWord)) return;
    if (declared.has(name) && isConstructorDecl(code, id)) return;
    // A type annotation goes between the qualifier and the simple name
    // (`java.lang.@NoNulChar String`): every annotation of a type argument,
    // and the trailing type-use annotations of a declaration.
    const run = ANNOTATION_RUN.exec(code.slice(0, id.start));
    let start = id.start;
    let moved = "";
    if (run !== null) {
      const anns = [...run[0].matchAll(ANNOTATION)];
      const typeArg = /[<,]\s*$/.test(code.slice(0, run.index)) && inTypeArgs(code, run.index);
      let k = anns.length;
      while (k > 0 && (typeArg || JAVA_TYPE_USE_ANNOTATIONS.has(anns[k - 1]![1]!))) k--;
      if (k < anns.length) {
        start = run.index + anns[k]!.index!;
        moved = code.slice(start, id.start);
      }
    }
    edits.push({ start, end: id.end, text: `${fq.slice(0, -name.length)}${moved}${name}` });
  });
  let out = code;
  let floor = Number.POSITIVE_INFINITY;
  for (const e of edits.reverse()) {
    if (e.end > floor) continue;
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    floor = e.start;
  }
  return out;
}

/** The annotations a unit places before a type that apply to the TYPE in
 *  some context the declaration propagates to (a record component's accessor
 *  method): before a qualified type each must follow the qualifier. */
const JAVA_TYPE_USE_ANNOTATIONS: ReadonlySet<string> = new Set(["NoNulChar"]);
/** The annotations written immediately before a name. */
const ANNOTATION_RUN =
  /(?:@\u{E010}?[A-Za-z_$][\w$.]*(?:\u{E012}\d+\u{E011})?(?:\([^()]*\))?\s+)+$/u;
const ANNOTATION = /@\u{E010}?([A-Za-z_$][\w$.]*)(?:\u{E012}\d+\u{E011})?(?:\([^()]*\))?\s+/gu;

/** True when `at` sits inside a type-argument list (`List<…>`): an unmatched
 *  `<` before it, with no unmatched `(` or statement boundary in between. */
function inTypeArgs(code: string, at: number): boolean {
  let angle = 0;
  let paren = 0;
  for (let i = at - 1; i >= 0; i--) {
    const c = code[i]!;
    if (c === ">") angle++;
    else if (c === "<") {
      if (angle === 0) return true;
      angle--;
    } else if (c === ")") paren++;
    else if (c === "(") {
      if (paren === 0) return false;
      paren--;
    } else if (c === ";" || c === "{" || c === "}") return false;
  }
  return false;
}

/** A constructor declaration: the type's name after a member modifier or at
 *  the start of a member, followed by its parameter list or (a record's
 *  compact constructor) its body. */
function isConstructorDecl(code: string, id: JavaIdent): boolean {
  const next = /^\s*([({])/.exec(code.slice(id.end))?.[1];
  if (next === undefined) return false;
  if (MEMBER_MODIFIERS.has(id.prevWord)) return true;
  return next === "(" && (id.prev === "{" || id.prev === "}" || id.prev === ";");
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
 *  settled: the simple name, then the reference's number in the unit.  The
 *  name scans as an identifier after `HOLD_OPEN`, which is how the bare-name
 *  scan tells it from a name the emitters spell bare. */
const HOLD_OPEN = "";
const HOLD_MID = "";
const HOLD_CLOSE = "";
const HOLD_RE = /([\w$]+)(\d+)/g;

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
  // A project reference: a domain type by name (`javaProjectRef`), or a
  // reference into one of the project's own packages, whose package is known.
  const isProjectRef = (s: ImportSymbol): boolean =>
    s.module === PROJECT_MODULE || s.module.startsWith(`${PROJECT_MODULE}.`);
  const isProject = (s: ImportSymbol): boolean => isProjectRef(s) || index.packages.has(s.module);
  const holds: { name: string; pkg?: string; kind?: string }[] = [];
  const holdOf = new Map<string, number>();
  const yields = (s: ImportSymbol): boolean =>
    !isProject(s) && s.module !== own && local.has(s.name!);
  const { text: spelled, used } = resolveMarkers(
    text,
    (s) => !isProject(s) && (s.module === own || s.module === "java.lang"),
    (s) => {
      if (!isProject(s)) return yields(s) ? `${s.module}.${s.name}` : spelling(s);
      const key = `${s.module}|${s.name}`;
      let i = holdOf.get(key);
      if (i === undefined) {
        i = holds.length;
        holdOf.set(key, i);
        holds.push(
          !isProjectRef(s)
            ? { name: s.name!, pkg: s.module }
            : s.module === PROJECT_MODULE
              ? { name: s.name! }
              : { name: s.name!, kind: s.module.slice(PROJECT_MODULE.length + 1) },
        );
      }
      return `${HOLD_OPEN}${s.name}${HOLD_MID}${i}${HOLD_CLOSE}`;
    },
  );
  const framework = used.filter((s) => !isProject(s) && !yields(s));
  const projectRefs = holds;
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
  const bare = bareSimpleNames(code);
  // The simple names an import may have to bind: the bare ones, and a
  // project reference the index cannot settle (added below).
  const wanted = new Set(bare);
  // Platform names a type of the unit's own takes (`String`, `List`,
  // `GetMapping`): each bare use is spelled by this fully-qualified name.
  const qualify = new Map<string, string>();

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
    // A unit cannot import a type of the name it declares.
    else if (declared.has(simpleOf(p)) && pkgOf(p) !== own) qualify.set(simpleOf(p), p);
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
      if (!wanted.has(n) || bound.has(n)) continue;
      if (!local.has(n)) bound.set(n, `${pkg}.${n}`);
      else if (bare.has(n)) qualify.set(n, `${pkg}.${n}`);
    }
  }

  // Project references: bare with an import, or fully qualified where the
  // simple name is taken in this unit.
  const projectPkg = (name: string, kind?: string): string | undefined => {
    const cands = index.byName.get(name) ?? [];
    const ofKind = kind === undefined ? [] : cands.filter((p) => p.endsWith(`.${kind}`));
    if (ofKind.length === 1) return ofKind[0];
    if (ownTypes.has(name)) return own;
    if (cands.length === 1) return cands[0];
    // A package the unit imports this name from by a single-type import holds
    // the generated type the emitters spell bare, not the domain type.
    const unbound = cands.filter((p) => bound.get(name) !== `${p}.${name}`);
    if (unbound.length === 1) return unbound[0];
    const viaOnDemand = cands.filter((p) => projectOnDemand.includes(p));
    return viaOnDemand.length === 1 ? viaOnDemand[0] : undefined;
  };
  const resolved = projectRefs.map((r) => r.pkg ?? projectPkg(r.name, r.kind));
  // Two project types of one simple name in a unit: at most the one of the
  // unit's own package is spelled bare.
  const pkgsByName = new Map<string, Set<string>>();
  resolved.forEach((pkg, i) => {
    if (pkg === undefined) return;
    const name = projectRefs[i]!.name;
    pkgsByName.set(name, (pkgsByName.get(name) ?? new Set()).add(pkg));
  });
  const spelledAs: string[] = projectRefs.map((r, i) => {
    const pkg = resolved[i];
    if (pkg === undefined) {
      // Not (uniquely) declared by the project: spelled as written, and
      // imported, like any other name the code spells, by an on-demand import.
      wanted.add(r.name);
      return r.name;
    }
    const fq = `${pkg}.${r.name}`;
    const shared = pkgsByName.get(r.name)!.size > 1;
    if (
      javaAmbientClash(r.name, fq, bound) ||
      (local.has(r.name) && pkg !== own) ||
      (shared && pkg !== own)
    ) {
      return fq;
    }
    if (pkg !== own) bound.set(r.name, fq);
    return r.name;
  });
  const spell = (l: string): string =>
    l.replace(HOLD_RE, (_m, _name: string, i: string) => spelledAs[Number(i)]!);

  // The project's own packages imported on demand: the types the code names
  // that no single-type import, own-package type, nested type or `java.lang`
  // type already binds (each of those would win over the on-demand import).
  // A name two such packages declare stays unimported, as it was ambiguous.
  const provider = new Map<string, string | null>();
  const shadowedProvider = new Map<string, string | null>();
  for (const pkg of projectOnDemand) {
    const members = index.packages.get(pkg);
    if (members === undefined && !(own !== undefined && sameProject(pkg, own))) {
      throw new Error(
        `${where}: imports '${pkg}.*' on demand, which is neither a project package nor a listed framework package (JAVA_FRAMEWORK_PACKAGES)`,
      );
    }
    for (const n of members ?? []) {
      if (!wanted.has(n) || bound.has(n)) continue;
      if (declared.has(n) || ownTypes.has(n)) {
        // The unit's own type takes the name; the emitters' bare use names
        // the imported package's type.
        if (bare.has(n) && pkg !== own) {
          shadowedProvider.set(n, shadowedProvider.has(n) ? null : pkg);
        }
        continue;
      }
      if (isJavaLangTypeName(n)) continue;
      provider.set(n, provider.has(n) ? null : pkg);
    }
  }
  for (const [n, pkg] of provider) if (pkg !== null) bound.set(n, `${pkg}.${n}`);
  for (const [n, pkg] of shadowedProvider) if (pkg !== null) qualify.set(n, `${pkg}.${n}`);

  // `java.lang` yields to a type of the unit's own package (or one it
  // declares): a bare `String` the emitters write for the platform type is
  // spelled `java.lang.String` there.
  for (const n of bare) {
    if (isJavaLangTypeName(n) && local.has(n) && !bound.has(n) && !qualify.has(n)) {
      qualify.set(n, `java.lang.${n}`);
    }
  }
  after = qualifyBare(after.join("\n"), qualify, declared).split("\n").map(spell);
  const head = before.map(spell);

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
