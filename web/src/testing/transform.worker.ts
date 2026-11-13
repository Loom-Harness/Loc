// esbuild-wasm worker for the test runner.  Two jobs:
//   - `transform`: type-strip a single self-contained file (API runner).
//   - `build`: bundle a generated test suite + its imports from an
//     in-memory file map, aliasing the test framework module (`vitest`
//     for unit suites, `@playwright/test` for UI suites) to a shim that
//     reads the harness off `globalThis`.  `import type` of generated
//     api types is dropped by the ts loader, so those need no
//     resolution.  The bundle is imported from a blob URL, which cannot
//     resolve a bare specifier, so the npm packages the suite imports
//     (`uuidv7`, `decimal.js`, …) are installed at the deployable's
//     package.json pins and bundled in.
//
// esbuild is initialised once per thread (the wasm bytes are already
// browser-cached from the project bundler).  Installs read through the same
// IndexedDB cache and npm mirror the bundler uses, so a dependency set the
// Bundle step installed replays without a registry tarball fetch.

import * as esbuild from "esbuild-wasm";
import wasmURL from "esbuild-wasm/esbuild.wasm?url";
import { makeVfsNpmPlugin } from "../engine/npm/esbuild-vfs-plugin.js";
import { install } from "../engine/npm/install.js";
import { getInstallCache, getNpmMirror } from "../engine/npm/install-sources.js";
import { installFailedMessage, pickSuiteDeps } from "./suite-deps.js";

export interface SuiteBuild {
  entry: string;
  files: Record<string, string>;
  /** Module specifier → replacement module source (a shim that
   *  reads the harness off `globalThis`). */
  aliases: Record<string, string>;
  /** The deployable's package.json `dependencies`: the pins the suite's
   *  bare imports install at.  Absent, bare imports stay external. */
  deps?: Record<string, string>;
  /** Absolute deploy base (origin + base path, trailing slash) for the
   *  npm-mirror fetch. */
  deployBase?: string;
}

export type TransformRequest =
  | { id: number; ts: string }
  | { id: number; build: SuiteBuild };

export interface TransformResponse {
  id: number;
  ok: boolean;
  code?: string;
  message?: string;
}

let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      const res = await fetch(wasmURL);
      if (!res.ok) {
        throw new Error(
          `transform.worker: failed to fetch esbuild wasm (${res.status} ${res.statusText})`,
        );
      }
      const wasmModule = await WebAssembly.compile(await res.arrayBuffer());
      await esbuild.initialize({ wasmModule, worker: false });
    })();
  }
  return initPromise;
}

function dirOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/") + 1);
}

// Node builtins the generated domain code imports (e.g. ids.ts uses
// `randomUUID` from `node:crypto`).  The browser can't resolve bare
// `node:*` specifiers, so shim the ones the generators emit onto Web
// platform equivalents — otherwise the bundled module fails to import.
const BUILTIN_ALIASES: Record<string, string> = {
  "node:crypto":
    "export const randomUUID = () => globalThis.crypto.randomUUID();",
  crypto: "export const randomUUID = () => globalThis.crypto.randomUUID();",
};

function normalize(path: string): string {
  const parts: string[] = [];
  for (const seg of path.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function resolveRelative(
  importer: string,
  rel: string,
  files: Record<string, string>,
): string | null {
  const base = normalize(dirOf(importer) + rel);
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (cand in files) return cand;
  }
  return null;
}

const SUITE_NS = "suite";

/** Resolves the suite's own files and the aliased modules.  Anything else —
 *  a bare package import — is left `external` (`"external"`: the scan pass
 *  that finds which packages the suite imports) or handed on to the npm
 *  plugin over the installed node_modules (`"installed"`). */
function vfsPlugin(
  files: Record<string, string>,
  callerAliases: Record<string, string>,
  bare: "external" | "installed",
): esbuild.Plugin {
  const aliases = { ...BUILTIN_ALIASES, ...callerAliases };
  return {
    name: "loom-test-vfs",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.path in aliases) {
          return { path: args.path, namespace: "alias" };
        }
        if (args.kind === "entry-point") {
          return { path: normalize(args.path), namespace: SUITE_NS };
        }
        if (args.namespace === SUITE_NS && args.path.startsWith(".")) {
          const resolved = resolveRelative(args.importer, args.path, files);
          if (resolved) return { path: resolved, namespace: SUITE_NS };
        }
        if (bare === "installed") return undefined;
        return { path: args.path, external: true };
      });
      build.onLoad({ filter: /.*/, namespace: "alias" }, (args) => ({
        contents: aliases[args.path],
        loader: "js",
      }));
      build.onLoad({ filter: /.*/, namespace: SUITE_NS }, (args) => ({
        contents: files[args.path] ?? "",
        loader: args.path.endsWith(".tsx") ? "tsx" : "ts",
      }));
    },
  };
}

/** Specifiers a scan-pass bundle left external. */
function externalImports(meta: esbuild.Metafile | undefined): Set<string> {
  const out = new Set<string>();
  for (const o of Object.values(meta?.outputs ?? {})) {
    for (const imp of o.imports ?? []) {
      if (imp.external) out.add(imp.path);
    }
  }
  return out;
}

async function buildSuite(req: SuiteBuild): Promise<string> {
  const common = {
    entryPoints: [req.entry],
    bundle: true,
    format: "esm" as const,
    write: false as const,
  };
  // Scan pass: bundle with every bare import external.  It is also the
  // finished bundle when the suite imports no package.
  const scan = await esbuild.build({
    ...common,
    metafile: true,
    plugins: [vfsPlugin(req.files, req.aliases, "external")],
  });
  const bare = externalImports(scan.metafile);
  if (bare.size === 0 || !req.deps) return scan.outputFiles[0].text;

  const { install: wanted } = pickSuiteDeps(bare, req.deps);
  const nodeModules = new Map<string, string | Uint8Array>();
  try {
    await install(wanted, (p, d) => nodeModules.set(p, d), {
      cache: await getInstallCache(),
      mirror: await getNpmMirror(req.deployBase ?? "/"),
    });
  } catch (e) {
    throw new Error(installFailedMessage(wanted, e));
  }
  const out = await esbuild.build({
    ...common,
    platform: "browser",
    logLevel: "silent",
    plugins: [
      vfsPlugin(req.files, req.aliases, "installed"),
      makeVfsNpmPlugin(nodeModules, "/node_modules"),
    ],
  });
  return out.outputFiles[0].text;
}

self.onmessage = async (ev: MessageEvent<TransformRequest>): Promise<void> => {
  const data = ev.data;
  try {
    await ensureInit();
    if ("build" in data) {
      self.postMessage({
        id: data.id,
        ok: true,
        code: await buildSuite(data.build),
      } satisfies TransformResponse);
      return;
    }
    const out = await esbuild.transform(data.ts, { loader: "ts", format: "esm" });
    self.postMessage({ id: data.id, ok: true, code: out.code } satisfies TransformResponse);
  } catch (e) {
    self.postMessage({
      id: data.id,
      ok: false,
      message:
        (e as { errors?: Array<{ text: string }> }).errors?.[0]?.text ??
        (e instanceof Error ? e.message : String(e)),
    } satisfies TransformResponse);
  }
};
