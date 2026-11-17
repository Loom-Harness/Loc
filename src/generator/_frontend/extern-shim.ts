// Where the machine-owned halves of the frontend extern hatch live.
//
// A `component <Name>(...) extern from "<path>"` or
// `function <name>(...): T extern from "<path>"` ui member splits ownership:
// the user writes the module at `<path>` (relative to `src/`), and Loom writes
// a re-export shim plus a typed contract file (`<Name>.props.ts` /
// `<name>.signature.ts`) beside it.  Every machine-owned file goes in one
// reserved `_extern` directory, so no user path outside it can name a file
// Loom writes: the documented `from "./components/<Name>"` form names exactly
// the file a shim would overwrite if the shim sat at the framework's ordinary
// component path.
//
// This module is the only place that spells the directory.  The four web
// frontends build every extern shim/contract path and every call-site import
// of one through it (`test/generator/_frontend/extern-shim-census.test.ts`).
// Pure and browser-safe: no `node:` import.

/** The four web frontends that emit extern shims. */
export type ExternShimFramework = "react" | "vue" | "svelte" | "angular";

/** The reserved, machine-owned directory name. */
const EXTERN_DIR = "_extern";

/** The framework's ordinary component directory below the project root.
 *  SvelteKit keeps components under `$lib`. */
function componentsDir(framework: ExternShimFramework): string {
  return framework === "svelte" ? "src/lib/components" : "src/components";
}

/** Strip the leading `./` or `/` off an `extern from` path, leaving the
 *  module path relative to `src/`. */
function externModuleRel(externPath: string): string {
  return externPath.replace(/^\.?\//, "");
}

/** `../` once per directory between `dir` (a project-root-relative path under
 *  `src/`) and `src/`. */
function upToSrc(dir: string): string {
  const depth = dir.split("/").length - 1;
  return "../".repeat(depth);
}

// ---------------------------------------------------------------------------
// Extern components
// ---------------------------------------------------------------------------

/** The machine-owned directory holding extern component shims + props. */
function externComponentDir(framework: ExternShimFramework): string {
  return `${componentsDir(framework)}/${EXTERN_DIR}`;
}

/** The re-export shim's path, e.g. `src/components/_extern/RiskBadge.tsx`.
 *  `ext` carries its dot (`.tsx`, `.ts`, `.svelte`). */
export function externComponentShimPath(
  framework: ExternShimFramework,
  name: string,
  ext: string,
): string {
  return `${externComponentDir(framework)}/${name}${ext}`;
}

/** The typed props file's path, beside the shim. */
export function externComponentPropsPath(framework: ExternShimFramework, name: string): string {
  return `${externComponentDir(framework)}/${name}.props.ts`;
}

/** The shim's import of its props sibling. */
export function externComponentPropsSpecifier(name: string): string {
  return `./${name}.props`;
}

/** The shim's import of the user's module at the `from` path. */
export function externComponentUserSpecifier(
  framework: ExternShimFramework,
  externPath: string,
): string {
  return `${upToSrc(externComponentDir(framework))}${externModuleRel(externPath)}`;
}

/** Rebase a relative specifier written for a file directly in the framework's
 *  component directory (`../api/order`) onto a file in the extern directory,
 *  one level deeper.  Bare and alias specifiers (`$lib/…`, `decimal.js`) are
 *  returned unchanged. */
export function rebaseIntoExternComponentDir(specifier: string): string {
  if (specifier.startsWith("./")) return `../${specifier.slice(2)}`;
  if (specifier.startsWith("../")) return `../${specifier}`;
  return specifier;
}

/** The names of the extern components in scope, from component lists in
 *  precedence order (top-level first, ui-scope last): a later declaration of
 *  the same name decides whether it is extern. */
export function externComponentNamesOf(
  ...lists: ReadonlyArray<ReadonlyArray<{ readonly name: string; readonly extern?: boolean }>>
): Set<string> {
  const out = new Set<string>();
  for (const list of lists) {
    for (const c of list) {
      if (c.extern) out.add(c.name);
      else out.delete(c.name);
    }
  }
  return out;
}

/** The import specifier a call site uses for a component.
 *  `componentsDirPrefix` is the importer's path to the framework's component
 *  directory, trailing slash included (`../components/`, `./`,
 *  `$lib/components/`).  A walked component resolves to `<prefix><Name><ext>`;
 *  an extern one resolves to its shim, `<prefix>_extern/<Name><externExt>`. */
export function componentImportSpecifier(
  componentsDirPrefix: string,
  name: string,
  isExtern: boolean,
  ext = "",
  externExt = ext,
): string {
  return isExtern
    ? `${componentsDirPrefix}${EXTERN_DIR}/${name}${externExt}`
    : `${componentsDirPrefix}${name}${ext}`;
}

// ---------------------------------------------------------------------------
// Extern functions
// ---------------------------------------------------------------------------

/** The machine-owned directory holding extern function shims + signatures.
 *  Every web frontend keeps it under `src/lib/`. */
export const EXTERN_FUNCTION_DIR = `src/lib/${EXTERN_DIR}`;

/** The conformance shim's path, e.g. `src/lib/_extern/fmt.ts`. */
export function externFunctionShimPath(name: string): string {
  return `${EXTERN_FUNCTION_DIR}/${name}.ts`;
}

/** The typed signature file's path, beside the shim. */
export function externFunctionSignaturePath(name: string): string {
  return `${EXTERN_FUNCTION_DIR}/${name}.signature.ts`;
}

/** The shim's import of its signature sibling. */
export function externFunctionSignatureSpecifier(name: string): string {
  return `./${name}.signature`;
}

/** The shim's import of the user's module at the `from` path. */
export function externFunctionUserSpecifier(externPath: string): string {
  return `${upToSrc(EXTERN_FUNCTION_DIR)}${externModuleRel(externPath)}`;
}

/** The import specifier a call site uses for an extern function's shim.
 *  `libPrefix` is the importer's path to `src/lib/`, trailing slash included
 *  (`../lib/`, `../../lib/`, `$lib/`). */
export function externFunctionImportSpecifier(libPrefix: string, name: string): string {
  return `${libPrefix}${EXTERN_DIR}/${name}`;
}
