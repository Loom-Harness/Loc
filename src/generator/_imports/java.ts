// ---------------------------------------------------------------------------
// Imports derived from use — Java (M-T9.86; design:
// docs/new-plan/missions/M-T9.84-derived-imports.md §3).  Symbol constructors
// and the compilation-unit finalizer: resolves `ref()` markers, merges the
// unit's remaining hand-written imports with the referenced types, and renders
// ONE import block in the google-java-format order:
//
//   static imports first (ASCII order), a blank line, then every other import
//   in ASCII order as one block; duplicates collapse.
//
// A referenced type needs NO line when it lives in the unit's own package, in
// `java.lang`, or in a package the unit already imports on demand (`pkg.*`).
// Java has no import aliasing, so two referenced types sharing a simple name
// is a thrown error — spell one fully qualified instead.
// ---------------------------------------------------------------------------

import { type ImportSymbol, ref, resolveMarkers, spelling, symbolKey } from "./symbol.js";

/** `import <pkg>.<Name>;` — a type (or nested type's outer class). */
export function javaType(pkg: string, name: string): ImportSymbol {
  return { lang: "java", module: pkg, name };
}

/** Shorthand: the marker for `import <pkg>.<Name>;`. */
export function javaRef(pkg: string, name: string): string {
  return ref(javaType(pkg, name));
}

/** The line a unit places where its import block goes when it has no
 *  hand-written import left (replaced by the derived block, or removed). */
export const JAVA_IMPORTS = "java-imports";

const IMPORT_RE = /^import\s+(static\s+)?([\w.]+(?:\.\*)?)\s*;\s*$/;
const PACKAGE_RE = /^package\s+([\w.]+)\s*;/m;

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
    if (/^import\s|^java-imports/.test(lines[i]!)) break;
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

export interface FinalizeJavaOptions {
  readonly path?: string;
}

/**
 * Finalize one Java compilation unit: spell every `ref()` marker, and replace
 * its leading import region (remaining hand-written imports and/or the
 * `JAVA_IMPORTS` slot) with the canonical block of every import it needs.  A
 * unit with neither a marker nor an import comes back unchanged.
 */
export function finalizeJavaUnit(text: string, opts: FinalizeJavaOptions = {}): string {
  const where = opts.path ?? "<java unit>";
  const own = PACKAGE_RE.exec(text)?.[1];
  const { text: spelled, used } = resolveMarkers(
    text,
    (s) => s.module === own || s.module === "java.lang",
  );
  const lines = spelled.split("\n");
  const region = leadingRegion(lines);
  if (region === null) {
    if (used.length > 0) {
      throw new Error(
        `${where}: references ${used.map(spelling).join(", ")} but has no import region (add a JAVA_IMPORTS slot)`,
      );
    }
    return spelled;
  }
  if (lines.slice(region.end).includes(JAVA_IMPORTS)) {
    throw new Error(`${where}: the JAVA_IMPORTS slot must sit in the unit's leading region`);
  }

  const plain = new Set(region.plain);
  const onDemand = new Set(region.plain.filter((p) => p.endsWith(".*")).map((p) => p.slice(0, -2)));
  // Simple-name collision: a referenced type against another referenced type
  // or a single-type hand import of the same simple name from elsewhere.
  const bySimple = new Map<string, string>();
  for (const p of region.plain) {
    if (!p.endsWith(".*")) bySimple.set(p.slice(p.lastIndexOf(".") + 1), p);
  }
  const seen = new Set<string>();
  for (const s of used) {
    if (seen.has(symbolKey(s))) continue;
    seen.add(symbolKey(s));
    const fq = `${s.module}.${s.name}`;
    const prior = bySimple.get(s.name!);
    if (prior !== undefined && prior !== fq) {
      throw new Error(
        `${where}: two imports bind '${s.name}' (${prior} and ${fq}) — spell one fully qualified`,
      );
    }
    bySimple.set(s.name!, fq);
    if (onDemand.has(s.module)) continue;
    plain.add(fq);
  }

  const statics = [...new Set(region.statics)].sort(ascii);
  const rest = [...plain].sort(ascii);
  const block = [
    ...statics.map((s) => `import static ${s};`),
    ...(statics.length > 0 && rest.length > 0 ? [""] : []),
    ...rest.map((p) => `import ${p};`),
  ];
  const before = lines.slice(0, region.start);
  let after = lines.slice(region.end);
  if (block.length === 0) return [...before, ...after].join("\n");
  // Exactly one blank line between the block and the declarations.
  let blanks = 0;
  while (blanks < after.length && after[blanks]!.trim() === "") blanks++;
  after = after.length === blanks ? after : ["", ...after.slice(blanks)];
  return [...before, ...block, ...after].join("\n");
}
