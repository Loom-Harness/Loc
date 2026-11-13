// The non-React frontends the preview bundles in the browser: each framework's
// own compiler, run as an esbuild plugin over the generated file map, plus the
// mount point its generated entry expects.
//
// Vue: `@vue/compiler-sfc` turns each `.vue` single-file component into a
// module (`<script setup>` with the template inlined) and each `<style>` block
// into a CSS module esbuild bundles into the frontend's stylesheet — what
// `@vitejs/plugin-vue` does under `vite dev`.
//
// The compiler is imported lazily, so a React-only system never loads it.

import type { Plugin } from "esbuild-wasm";

/** A frontend framework the preview compiles in the browser. */
export type CompiledFramework = "vue";

/** The vfs plugin's namespace for generated + installed files. */
const NS = "vfs";
const STYLE_NS = "loom-vue-style";
const MOUNT_NS = "loom-mount";

/** The specifier of the module that adds the element the generated entry
 *  mounts on (`#app`) inside the preview's `#root`.  The entry imports it
 *  before the app, so the element exists when the app mounts — and it lives
 *  inside `#root`, which the preview replaces on every reload. */
export const MOUNT_SPECIFIER = "loom:mount";

/** The synthesised entry of a compiled frontend: the mount point, then the
 *  generated entry. */
export function frontendStdin(entry: string): string {
  return `import ${JSON.stringify(MOUNT_SPECIFIER)};\nimport ${JSON.stringify(entry)};\n`;
}

const MOUNT_SOURCE = `const root = document.getElementById("root") ?? document.body;
if (!document.getElementById("app")) {
  const el = document.createElement("div");
  el.id = "app";
  root.appendChild(el);
}
`;

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
  }
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
  /** Compiled styles, by their virtual module path. */
  const styles = new Map<string, string>();
  return {
    name: `loom-${framework}`,
    setup(build) {
      build.onResolve({ filter: /^loom:mount$/ }, () => ({ path: MOUNT_SPECIFIER, namespace: MOUNT_NS }));
      build.onLoad({ filter: /.*/, namespace: MOUNT_NS }, () => ({ contents: MOUNT_SOURCE, loader: "js" }));
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
    },
  };
}
