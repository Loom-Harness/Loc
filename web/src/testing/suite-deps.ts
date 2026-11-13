// Which npm packages a generated test suite needs installed before it can be
// bundled.  A suite is bundled into a blob module, and a blob module cannot
// resolve a bare specifier, so every package the suite's code imports has to
// be installed and bundled in.  The versions come from the deployable's own
// package.json — the same pins the Bundle step installs.

import type { VirtualFile } from "../build/protocol.js";

/** `dependencies` of the package.json nearest to `path` (walking up from its
 *  directory), or `{}` when there is none. */
export function nearestPackageDeps(
  files: readonly VirtualFile[],
  path: string,
): Record<string, string> {
  const byPath = new Map(files.map((f) => [f.path.replace(/^\//, ""), f.content]));
  const parts = path.replace(/^\//, "").split("/");
  for (let i = parts.length - 1; i >= 0; i--) {
    const raw = byPath.get([...parts.slice(0, i), "package.json"].join("/"));
    if (raw == null) continue;
    try {
      const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> };
      return { ...(pkg.dependencies ?? {}) };
    } catch {
      /* unreadable package.json: keep walking up */
    }
  }
  return {};
}

/** The package a bare import specifier names (`decimal.js`,
 *  `@scope/pkg/sub` → `@scope/pkg`), or null for a relative / absolute path,
 *  a `node:` builtin or a URL. */
export function packageNameOf(spec: string): string | null {
  if (spec.startsWith(".") || spec.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(spec)) {
    return null;
  }
  const segs = spec.split("/");
  if (spec.startsWith("@")) return segs.length >= 2 && segs[1] ? `${segs[0]}/${segs[1]}` : null;
  return segs[0] || null;
}

/** The discovery error for a failed install of the suite's packages.  The
 *  Tests panel's hint reads its "could not install" prefix to tell a network
 *  failure from a broken suite. */
export function installFailedMessage(wanted: Record<string, string>, cause: unknown): string {
  const list = Object.entries(wanted)
    .map(([n, v]) => `${n}@${v}`)
    .join(", ");
  const why = cause instanceof Error ? cause.message : String(cause);
  return `could not install the suite's npm dependencies (${list}): ${why}`;
}

/** Split the bare specifiers a suite imports into the packages to install
 *  (name → the package.json range) and the ones package.json does not
 *  declare. */
export function pickSuiteDeps(
  specs: Iterable<string>,
  deps: Record<string, string>,
): { install: Record<string, string>; undeclared: string[] } {
  const install: Record<string, string> = {};
  const undeclared = new Set<string>();
  for (const spec of specs) {
    const name = packageNameOf(spec);
    if (name == null) continue;
    if (Object.hasOwn(deps, name)) install[name] = deps[name] as string;
    else undeclared.add(name);
  }
  return { install, undeclared: [...undeclared].sort() };
}

/** A generated suite that failed to build or import during discovery. */
export interface SuiteLoadFailure {
  /** The suite's label in the Tests list ("orders", "UI", "API"). */
  suite: string;
  /** The generated file it was loaded from. */
  path: string;
  message: string;
}

/** The discovery error for the suites that failed to load: one paragraph per
 *  suite, naming it and its file, so the raw text says which and why. */
export function formatSuiteLoadFailures(failures: readonly SuiteLoadFailure[]): string {
  return failures.map((f) => `${f.suite} (${f.path}): ${f.message}`).join("\n\n");
}
