// ---------------------------------------------------------------------------
// Filesystem-backed pack loader (Node-only).
//
// The pure compilation core lives in `loader.ts` and is browser-safe;
// this module is the Node bridge that reads `pack.json` + .hbs files
// off disk and feeds them into `compilePack`.  Built-in packs live
// under `<repo>/designs/<name>/`; custom packs are user-supplied
// directories referenced by absolute or .ddd-relative path.
//
// The playground swaps this module for `web/src/build/template-bundled.ts`
// at bundle time (see `web/vite.config.ts`) — that variant pre-loads
// every design via `import.meta.glob` so generation runs entirely in
// the browser worker with no fs.
// ---------------------------------------------------------------------------

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { diagMessage } from "../../diagnostics/messages.js";
import { parseBuiltinDesignRef } from "../../util/builtin-formats.js";
import { compilePack, type LoadedPack, type PackFormat, type PackManifest } from "./loader.js";
import {
  type DesignPackInspector,
  describePackDefects,
  isKnownPackFormat,
  manifestDefects,
  type PackDefect,
  type PackInspection,
} from "./pack-defects.js";

/** Names of the repo-root template directories that supply
 *  pack-agnostic Handlebars sources, keyed by pack format.  TSX packs
 *  (mantine, shadcn) consume the React/Vite/Docker scaffolds; HEEx
 *  packs (coreComponents) consume their own future `phoenix/` shared
 *  layer (empty in v0 — the coreComponents pack ships its shell files
 *  directly).  Each directory is read flat — no nesting — and merged
 *  into a single shared-sources map keyed by logical name. */
const SHARED_SOURCE_DIRS_TSX = ["vite", "api", "docker"] as const;
const SHARED_SOURCE_DIRS_HEEX: readonly string[] = ["phoenix"];
// Svelte packs read their own shared layer only: the SvelteKit
// dockerfile diverges from the TSX one (the preview server needs the
// kit project context, not a bare dist/), and duplicate logical names
// across shared dirs throw (sveltekit/ ships its own dockerfile.hbs)
// — so `docker/` stays TSX/vue-side.
const SHARED_SOURCE_DIRS_SVELTE: readonly string[] = ["sveltekit"];
// Vue packs share a Vue-specific layer (`vue/`: index.html,
// tsconfig-node, the NotFound page) plus the framework-neutral `api/`
// fetch-client/config/logger sources (plain TS, no JSX — the React
// `error-boundary` template rides along unused) and the neutral
// `docker/` vite-build/vite-preview two-stage scaffold.
const SHARED_SOURCE_DIRS_VUE: readonly string[] = ["vue", "api", "docker"];
// Angular packs share an Angular-specific layer (`angular/`: index.html
// with `<app-root>`, its own `ng build` → static-serve dockerfile) plus
// the framework-neutral `api/` fetch-client/config/logger sources.  The
// neutral `docker/` vite two-stage does NOT apply (Angular builds with
// `ng build`, not `vite build`/`vite preview`), so `angular/` ships its
// own dockerfile.hbs — and duplicate logical names across shared dirs
// throw, so `docker/` stays out (same split as svelte's sveltekit/).
const SHARED_SOURCE_DIRS_ANGULAR: readonly string[] = ["angular", "api"];

/** Resolve the repo-root directory by walking up from this file
 *  until a `designs/` sibling is found.  Used to anchor both the
 *  built-in pack lookup and the shared-source directories. */
function repoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, "designs");
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  throw new Error(
    `loader: could not locate repo root (looked for a sibling \`designs/\` directory) walking up from ${here}`,
  );
}

/** Resolve a pack identifier to an absolute pack directory.
 *  `referenceDir` is the directory the .ddd source lives in — used
 *  to anchor relative custom-pack paths.
 *
 *  Built-in identifiers carry a `family@version` segment after Phase
 *  0 of the pack-versioning rollout: bareword `mantine` resolves to
 *  the toolchain default version via `BUILTIN_PACK_LATEST`; an
 *  explicit pin `mantine@v9` skips the default.  Either way the pack
 *  lives under `<repo>/designs/<family>/<version>/`.  Anything that
 *  isn't a registered family falls through to the custom-pack path
 *  resolution. */
export function resolvePackDir(ui: string, referenceDir?: string): string {
  const parsed = parseBuiltinDesignRef(ui);
  if (parsed) {
    return path.join(repoRoot(), "designs", parsed.family, parsed.version);
  }
  // Treat anything else as a path.  Absolute paths used as-is;
  // relative paths anchored against the .ddd file's dir when
  // available, otherwise the current working directory.
  if (path.isAbsolute(ui)) return ui;
  return path.resolve(referenceDir ?? process.cwd(), ui);
}

/** Read every `.hbs` file in each of the repo-root shared-source
 *  directories that match the pack's `format` (TSX packs read
 *  `vite/`+`api/`+`docker/`; HEEx packs read `phoenix/`) and return
 *  them keyed by logical name (the filename minus `.hbs`).  Shared
 *  templates are pack-agnostic within their format: preparers refer
 *  to them by logical name and they emit identically regardless of
 *  which design pack of that format is active.  Missing directories
 *  are silently skipped — keeps the contract opt-in. */
function readSharedSources(format: PackFormat): Record<string, string> {
  const root = repoRoot();
  const out: Record<string, string> = {};
  const dirs =
    format === "heex"
      ? SHARED_SOURCE_DIRS_HEEX
      : format === "svelte"
        ? SHARED_SOURCE_DIRS_SVELTE
        : format === "vue"
          ? SHARED_SOURCE_DIRS_VUE
          : format === "angular"
            ? SHARED_SOURCE_DIRS_ANGULAR
            : SHARED_SOURCE_DIRS_TSX;
  for (const dirName of dirs) {
    const dir = path.join(root, dirName);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".hbs")) continue;
      const logicalName = file.slice(0, -".hbs".length);
      if (out[logicalName] != null) {
        throw new Error(
          `loader: duplicate shared template "${logicalName}" — defined under multiple shared dirs.  Logical names must be unique across the active format's shared directories.`,
        );
      }
      out[logicalName] = fs.readFileSync(path.join(dir, file), "utf-8");
    }
  }
  return out;
}

/** What reading a pack directory produced: the manifest and template sources
 *  when they could be read, and every defect the READ itself hit (no
 *  `pack.json`, unparseable JSON, no `emits`, a missing `.hbs`, an unknown
 *  `stack`).  The defects the manifest + sources show are `manifestDefects`'
 *  (`pack-defects.ts`), shared with `compilePack`. */
interface PackRead {
  manifest?: PackManifest;
  sources: Record<string, string>;
  sharedSources: Record<string, string>;
  defects: PackDefect[];
}

function readPackDir(packDir: string): PackRead {
  const read: PackRead = { sources: {}, sharedSources: {}, defects: [] };
  const manifestPath = path.join(packDir, "pack.json");
  if (!fs.existsSync(manifestPath) || !fs.statSync(manifestPath).isFile()) {
    read.defects.push({
      kind: "manifest-missing",
      message: `no pack.json at ${manifestPath} (a pack is a directory containing a pack.json manifest)`,
    });
    return read;
  }
  let manifest: PackManifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as PackManifest;
  } catch (err) {
    read.defects.push({
      kind: "manifest-unreadable",
      message: `${manifestPath} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    });
    return read;
  }
  if (manifest == null || typeof manifest !== "object" || Array.isArray(manifest)) {
    read.defects.push({
      kind: "manifest-unreadable",
      message: `${manifestPath} is not a JSON object`,
    });
    return read;
  }
  read.manifest = manifest;
  const emits = manifest.emits as unknown;
  if (emits == null || typeof emits !== "object" || Array.isArray(emits)) {
    // `manifestDefects` names this one; nothing further can be read.
    return read;
  }
  // Pack-versioning cross-check: when a pack lives under the
  // built-in `designs/<family>/<vNN>/` tree, the parent dir name is
  // load-bearing — it's what `design: family@vNN` resolves to.  A
  // mismatch with `manifest.version` means a copy-paste fork left the
  // manifest pointing at the old version; that would silently shadow
  // sibling packs.  Bail loudly instead.  Only fires for paths that
  // match the built-in layout; arbitrary custom packs are exempt.
  const builtinSegments = path.relative(path.join(repoRoot(), "designs"), packDir).split(path.sep);
  if (
    builtinSegments.length === 2 &&
    !builtinSegments[0].startsWith("..") &&
    manifest.version !== builtinSegments[1]
  ) {
    throw new Error(
      `loader: pack at ${packDir} has version="${manifest.version}" but lives under directory "${builtinSegments[1]}".  The two must match (e.g. designs/mantine/v7/pack.json must declare "version": "v7").`,
    );
  }
  for (const [logicalName, fileName] of Object.entries(manifest.emits)) {
    const filePath = typeof fileName === "string" ? path.join(packDir, fileName) : undefined;
    if (filePath === undefined || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      read.defects.push({
        kind: "template-missing",
        message: `template "${logicalName}" → ${JSON.stringify(fileName)} not found${filePath ? ` at ${filePath}` : ""}`,
      });
      continue;
    }
    read.sources[logicalName] = fs.readFileSync(filePath, "utf-8");
  }
  read.sharedSources = readSharedSources(manifest.format ?? "tsx");
  // Stack templates.  When the pack declares
  // `stack: "vN"`, pull every `.hbs` from `<repo>/stacks/<vN>/`
  // into the same shared-partials map so pack templates can
  // `{{> stack-package-deps}}` etc.  Stack files are siblings of
  // pack-shared partials — same registration order semantics.  Pack
  // templates still win when names collide (compilePack registers
  // shared first, then pack overwrites).
  if (manifest.stack) {
    const stackDir = path.join(repoRoot(), "stacks", String(manifest.stack));
    if (
      typeof manifest.stack !== "string" ||
      !/^[\w.-]+$/.test(manifest.stack) ||
      !fs.existsSync(stackDir) ||
      !fs.statSync(stackDir).isDirectory()
    ) {
      const known = fs.existsSync(path.join(repoRoot(), "stacks"))
        ? fs
            .readdirSync(path.join(repoRoot(), "stacks"), { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort()
        : [];
      read.defects.push({
        kind: "stack-unknown",
        message: `pack.json declares stack ${JSON.stringify(manifest.stack)}, which is not a shipped stack (known: ${known.join(", ")})`,
      });
      return read;
    }
    for (const file of fs.readdirSync(stackDir)) {
      if (!file.endsWith(".hbs")) continue;
      const logicalName = file.slice(0, -".hbs".length);
      if (read.sharedSources[logicalName] != null) {
        throw new Error(
          `loader: stack ${manifest.stack} partial '${logicalName}' clashes with an existing shared template name.  Rename one.`,
        );
      }
      read.sharedSources[logicalName] = fs.readFileSync(path.join(stackDir, file), "utf-8");
    }
  }
  return read;
}

/** Every defect in the pack at `packDir` — the read-time ones plus
 *  `manifestDefects` — without throwing.  What phase ⑦ reports as
 *  `loom.design-pack-invalid`; `loadPack` refuses exactly the same set. */
export function inspectPackDir(
  packDir: string,
  options: { validateRequired?: boolean } = {},
): PackInspection {
  const read = readPackDir(packDir);
  if (read.manifest === undefined) return { defects: read.defects };
  const stackUnknown = read.defects.some((d) => d.kind === "stack-unknown");
  return {
    // An unknown format is a defect (`format-unknown`), not a format to
    // compare against the framework's.
    format: isKnownPackFormat(read.manifest.format ?? "tsx")
      ? (read.manifest.format ?? "tsx")
      : undefined,
    defects: [
      ...read.defects,
      ...manifestDefects(read.manifest, read.sources, read.sharedSources, options).filter(
        (d) =>
          // A file the read could not find is already reported, with its path;
          // and with no stack, every `{{> stack-…}}` partial is missing too —
          // noise behind the one defect that matters.
          d.kind !== "template-missing" && !(stackUnknown && d.kind === "partial-unknown"),
      ),
    ],
  };
}

/** The Node `DesignPackInspector` phase ⑦ is handed by the CLI: resolve the
 *  `design:` value against the declaring `.ddd` file's directory (or
 *  `fallbackDir`, for a caller whose model carries no file location) and
 *  inspect the directory.  Built-in packs are the toolchain's own and are not
 *  re-inspected. */
export function fsDesignPackInspector(fallbackDir?: string): DesignPackInspector {
  const cache = new Map<string, PackInspection>();
  return (design, baseDir) => {
    if (parseBuiltinDesignRef(design)) return null;
    const dir = resolvePackDir(design, baseDir ?? fallbackDir);
    let hit = cache.get(dir);
    if (hit === undefined) {
      hit = inspectPackDir(dir);
      cache.set(dir, hit);
    }
    return hit;
  };
}

/** Load a pack from disk.  Reads pack.json, resolves every template
 *  named in `emits`, compiles each with Handlebars, and returns a
 *  ready-to-use LoadedPack.  Also pulls in the repo-root shared
 *  directories (`vite/`, `api/`, `docker/`) as pack-agnostic
 *  partials available to every loaded pack. */
export function loadPack(
  packDir: string,
  options: { validateRequired?: boolean } = {},
): LoadedPack {
  const read = readPackDir(packDir);
  if (read.manifest === undefined || read.defects.length > 0) {
    throw new Error(
      diagMessage("loom.design-pack-invalid#load", {
        pack: packDir,
        defects: describePackDefects(read.defects),
      }),
    );
  }
  return compilePack(
    packDir,
    read.manifest,
    read.sources,
    (f) => path.join(packDir, f),
    read.sharedSources,
    options,
  );
}
