// The non-React frontends the preview bundles in the browser: each framework's
// own compiler, run as an esbuild plugin over the generated file map, plus the
// mount point its generated entry expects.
//
// Vue: `@vue/compiler-sfc` turns each `.vue` single-file component into a
// module (`<script setup>` with the template inlined) and each `<style>` block
// into a CSS module esbuild bundles into the frontend's stylesheet — what
// `@vitejs/plugin-vue` does under `vite dev`.
//
// Svelte: the `svelte` compiler builds each component, and a small client
// router stands in for SvelteKit (`sveltekit-shim.ts`).
//
// Angular: compiled just in time — the generated app's own `@angular/compiler`
// compiles each standalone component's inline template when it is first used,
// so the bundle needs only decorators (`experimentalDecorators`) and an entry
// that loads what `ng build` would: the `angular.json` polyfills and styles,
// the compiler, then `main.ts`.  The generated components take their
// dependencies through `inject()`, which JIT resolves without the constructor
// parameter metadata only the AOT compiler records.
//
// Each compiler is imported lazily, so a React-only system never loads it.

import type { Plugin, PluginBuild } from "esbuild-wasm";
import { setupSvelte, SVELTEKIT_APP } from "./sveltekit-shim.js";

/** A frontend framework the preview compiles in the browser. */
export type CompiledFramework = "vue" | "svelte" | "angular";

/** The vfs plugin's namespace for generated + installed files. */
const NS = "vfs";
const STYLE_NS = "loom-vue-style";
const MOUNT_NS = "loom-mount";
const ANGULAR_NS = "loom-angular";
const ANGULAR_APP = "loom:angular-app";

/** The specifier of the module that adds the element the generated entry
 *  mounts on (`#app`, Angular's `<app-root>`) inside the preview's `#root`.
 *  The entry imports it before the app, so the element exists when the app
 *  mounts — and it lives inside `#root`, which the preview replaces on every
 *  reload. */
export const MOUNT_SPECIFIER = "loom:mount";

/** The synthesised entry of a compiled frontend: the mount point, then the
 *  generated entry — for SvelteKit, which has none, the router over the
 *  routes beside `entry` (`<slug>/src/app.html`). */
export function frontendStdin(entry: string, framework: CompiledFramework): string {
  const dir = entry.slice(0, entry.lastIndexOf("/"));
  const app =
    framework === "svelte"
      ? `${SVELTEKIT_APP}?root=${dir}`
      : framework === "angular"
        ? `${ANGULAR_APP}?root=${dir.slice(0, dir.lastIndexOf("/"))}`
        : entry;
  return `import ${JSON.stringify(`${MOUNT_SPECIFIER}?framework=${framework}`)};\nimport ${JSON.stringify(app)};\n`;
}

const MOUNT_SOURCE = `const root = document.getElementById("root") ?? document.body;
if (!document.getElementById("app")) {
  const el = document.createElement("div");
  el.id = "app";
  root.appendChild(el);
}
`;

// Angular bootstraps into its root component's selector, and its router reads
// the app's base path off \`<base href>\` — here the preview's basename.
const ANGULAR_MOUNT_SOURCE = `const root = document.getElementById("root") ?? document.body;
if (!root.querySelector("app-root")) root.appendChild(document.createElement("app-root"));
let base = document.querySelector("base");
if (!base) { base = document.createElement("base"); document.head.prepend(base); }
base.setAttribute("href", (window.__LOOM_BASENAME__ ?? "").replace(/\\/$/, "") + "/");
`;

/** The Angular entry: what `ng build` loads around `main.ts`, read off the
 *  project's `angular.json` build target. */
export function angularAppModule(root: string, angularJson: string | undefined): string {
  let options: { browser?: string; main?: string; polyfills?: string[] | string; styles?: unknown[] } = {};
  try {
    const json = JSON.parse(angularJson ?? "{}") as {
      projects?: Record<string, { architect?: { build?: { options?: typeof options } } }>;
    };
    options = Object.values(json.projects ?? {})[0]?.architect?.build?.options ?? {};
  } catch {
    // no angular.json: main.ts alone
  }
  const local = (p: string): string => (p.startsWith(".") || p.startsWith("src/") ? `${root}/${p.replace(/^\.\//, "")}` : p);
  const polyfills = typeof options.polyfills === "string" ? [options.polyfills] : (options.polyfills ?? []);
  const styles = (options.styles ?? [])
    .map((s) => (typeof s === "string" ? s : (s as { input?: string }).input))
    .filter((s): s is string => typeof s === "string");
  const main = options.browser ?? options.main ?? "src/main.ts";
  return [
    ...polyfills.map((p) => `import ${JSON.stringify(local(p))};`),
    `import "@angular/compiler";`,
    ...styles.map((s) => `import ${JSON.stringify(local(s))};`),
    `import ${JSON.stringify(local(main))};`,
    "",
  ].join("\n");
}

/** Compile-time flags the framework's runtime reads (`vite dev` defines the
 *  same through the framework's plugin). */
export function frameworkDefines(framework: CompiledFramework): Record<string, string> {
  switch (framework) {
    case "vue":
      return {
        __VUE_OPTIONS_API__: "true",
        __VUE_PROD_DEVTOOLS__: "false",
        __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: "false",
      };
    case "svelte":
    case "angular":
      return {};
  }
}

/** The TypeScript options the framework's sources compile under. */
export function frameworkTsconfig(framework: CompiledFramework): string | undefined {
  return framework === "angular"
    ? JSON.stringify({ compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } })
    : undefined;
}

type SfcCompiler = typeof import("@vue/compiler-sfc");
let sfcCompiler: Promise<SfcCompiler> | null = null;
function loadSfc(): Promise<SfcCompiler> {
  sfcCompiler ??= import("@vue/compiler-sfc");
  return sfcCompiler;
}

/** A short stable id per component path — the scoped-style attribute. */
function scopeId(path: string): string {
  let h = 5381;
  for (let i = 0; i < path.length; i++) h = ((h << 5) + h + path.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** The esbuild plugin compiling `framework`'s components out of `files`.
 *  Registered BEFORE the vfs plugin, whose catch-all `onLoad` would otherwise
 *  hand a `.vue` file to esbuild as plain JS. */
export function frameworkPlugin(
  framework: CompiledFramework,
  files: Map<string, string | Uint8Array>,
): Plugin {
  const td = new TextDecoder();
  const read = (p: string): string | undefined => {
    const v = files.get(p);
    return v == null ? undefined : typeof v === "string" ? v : td.decode(v);
  };
  return {
    name: `loom-${framework}`,
    setup(build) {
      build.onResolve({ filter: /^loom:mount/ }, (args) => ({ path: args.path, namespace: MOUNT_NS }));
      build.onLoad({ filter: /.*/, namespace: MOUNT_NS }, () => ({
        contents: framework === "angular" ? ANGULAR_MOUNT_SOURCE : MOUNT_SOURCE,
        loader: "js",
      }));
      if (framework === "vue") setupVue(build, files, read);
      else if (framework === "svelte") setupSvelte(build, files, read);
      else {
        build.onResolve({ filter: /^loom:angular-app/ }, (args) => ({ path: args.path, namespace: ANGULAR_NS }));
        build.onLoad({ filter: /.*/, namespace: ANGULAR_NS }, (args) => {
          const root = new URLSearchParams(args.path.slice(args.path.indexOf("?") + 1)).get("root") ?? "";
          return { contents: angularAppModule(root, read(`${root}/angular.json`)), loader: "js", resolveDir: root || "/" };
        });
      }
    },
  };
}

function setupVue(
  build: PluginBuild,
  files: Map<string, string | Uint8Array>,
  read: (p: string) => string | undefined,
): void {
  /** Compiled styles, by their virtual module path. */
  const styles = new Map<string, string>();
      build.onResolve({ filter: /\?vue&type=style/ }, (args) => ({ path: args.path, namespace: STYLE_NS }));
      build.onLoad({ filter: /.*/, namespace: STYLE_NS }, (args) => ({
        contents: styles.get(args.path) ?? "",
        loader: "css",
      }));
      build.onLoad({ filter: /\.vue$/, namespace: NS }, async (args) => {
        const source = read(args.path);
        if (source == null) return { errors: [{ text: `vfs: missing ${args.path}` }] };
        const sfc = await loadSfc();
        const { descriptor, errors } = sfc.parse(source, { filename: args.path });
        if (errors.length > 0) {
          return { errors: errors.map((e) => ({ text: `${args.path}: ${e.message}` })) };
        }
        const id = scopeId(args.path);
        const hasScoped = descriptor.styles.some((s) => s.scoped);
        let code: string;
        let lang = "js";
        try {
          if (descriptor.script || descriptor.scriptSetup) {
            const script = sfc.compileScript(descriptor, {
              id,
              inlineTemplate: true,
              templateOptions: { transformAssetUrls: false },
              genDefaultAs: "_sfc_main",
              fs: { fileExists: (p) => files.has(p), readFile: read },
            });
            lang = (descriptor.scriptSetup ?? descriptor.script)?.lang ?? "js";
            code = script.content;
          } else {
            code = "const _sfc_main = {};";
          }
          if (!descriptor.scriptSetup && descriptor.template) {
            const tpl = sfc.compileTemplate({
              source: descriptor.template.content,
              filename: args.path,
              id,
              scoped: hasScoped,
              compilerOptions: { scopeId: hasScoped ? `data-v-${id}` : undefined },
              transformAssetUrls: false,
            });
            if (tpl.errors.length > 0) throw new Error(String(tpl.errors[0]));
            code += `\n${tpl.code.replace("export function render", "function _sfc_render")}\n_sfc_main.render = _sfc_render;`;
          }
        } catch (err) {
          return { errors: [{ text: `${args.path}: ${err instanceof Error ? err.message : String(err)}` }] };
        }
        descriptor.styles.forEach((style, index) => {
          const css = sfc.compileStyle({
            source: style.content,
            filename: args.path,
            id: `data-v-${id}`,
            scoped: style.scoped,
          });
          const virtual = `${args.path}?vue&type=style&index=${index}.css`;
          styles.set(virtual, css.code);
          code += `\nimport ${JSON.stringify(virtual)};`;
        });
        if (hasScoped) code += `\n_sfc_main.__scopeId = "data-v-${id}";`;
        code += "\nexport default _sfc_main;";
        return {
          contents: code,
          loader: lang === "ts" ? "ts" : "js",
          resolveDir: args.path.slice(0, args.path.lastIndexOf("/")) || "/",
        };
      });
}
